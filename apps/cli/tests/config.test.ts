import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createAstroInlineConfig, createSlidaAstroConfig, DEFAULT_DEV_PORT } from "../src/astro.ts";
import { loadSlidaConfig } from "../src/config.ts";
import { resolveSlidaTheme } from "../src/theme.ts";
import type { SlidaRuntimePaths } from "../src/types.ts";

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-config-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

function testPaths(projectRoot = resolve("/tmp/slida-project")): SlidaRuntimePaths {
  return {
    projectRoot,
    runtimeSourceDir: join(projectRoot, "node_modules/@slida/cli/runtime"),
    runtimeOutDir: join(projectRoot, ".slida/runtime"),
  };
}

function serverPort(config: ReturnType<typeof createAstroInlineConfig>) {
  return (config.server as { port?: number } | undefined)?.port;
}

type TestVitePlugin = {
  name?: string;
  resolveId?: (this: unknown, id: string) => unknown;
  load?: (this: { addWatchFile(filePath: string): void }, id: string) => unknown;
};

function vitePlugins(config: ReturnType<typeof createAstroInlineConfig>) {
  return (config.vite?.plugins ?? []) as TestVitePlugin[];
}

async function loadVirtualDeckModule(config: ReturnType<typeof createAstroInlineConfig>) {
  const plugin = vitePlugins(config).find((candidate) => candidate.name === "slida:virtual-deck");
  expect(plugin).toBeDefined();

  const resolvedId = await plugin?.resolveId?.call({}, "virtual:slida/deck");
  expect(typeof resolvedId).toBe("string");

  const loaded = await plugin?.load?.call({ addWatchFile() {} }, resolvedId as string);
  expect(typeof loaded).toBe("string");

  return loaded as string;
}

async function writeAstroDeck(projectRoot: string) {
  await mkdir(join(projectRoot, "slides"));
  await writeFile(
    join(projectRoot, "slides", "deck.astro"),
    `---
import Page from "@slida/cli/page";
---

<Page><h1>Deck</h1></Page>
`,
  );
}

async function writeThemePackage(projectRoot: string, packageName: string) {
  const packageDir = join(projectRoot, "node_modules", ...packageName.split("/"));
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: packageName, type: "module", exports: { ".": "./theme.css" } }),
  );
  await writeFile(join(packageDir, "theme.css"), ":root { --slida-accent: tomato; }\n");
}

test("loadSlidaConfig loads a project-root TypeScript config", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");

    await expect(loadSlidaConfig(projectRoot)).resolves.toMatchObject({
      config: { port: 3000 },
      filePath: join(projectRoot, "slida.config.ts"),
    });
  });
});

test("loadSlidaConfig returns an empty config when no config file exists", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(loadSlidaConfig(projectRoot)).resolves.toEqual({ config: {} });
  });
});

test("loadSlidaConfig rejects multiple project-root config files", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");
    await writeFile(join(projectRoot, "slida.config.js"), "export default { port: 3001 };\n");

    await expect(loadSlidaConfig(projectRoot)).rejects.toThrow(/Multiple Slida config files found/);
  });
});

test("loadSlidaConfig rejects non-object config exports", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default () => ({ port: 3000 });\n",
    );

    await expect(loadSlidaConfig(projectRoot)).rejects.toThrow(
      /Slida config must default-export an object/,
    );
  });
});

test("createSlidaAstroConfig uses config port when CLI/API port is omitted", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");

    const { astroConfig, slidaConfigFile } = await createSlidaAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(serverPort(astroConfig)).toBe(3000);
    expect(slidaConfigFile).toBe(await realpath(join(projectRoot, "slida.config.ts")));
  });
});

test("explicit API port wins over config port", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");

    const { astroConfig } = await createSlidaAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      port: 3333,
    });

    expect(serverPort(astroConfig)).toBe(3333);
  });
});

test("resolveSlidaTheme defaults to the first-party default theme", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveSlidaTheme(projectRoot)).resolves.toMatchObject({
      name: "default",
      source: "builtin",
    });
  });
});

test("resolveSlidaTheme maps built-in short names to first-party theme packages", async () => {
  await withProjectRoot(async (projectRoot) => {
    const theme = await resolveSlidaTheme(projectRoot, "minimal");

    expect(theme.name).toBe("minimal");
    expect(theme.source).toBe("builtin");
    expect(theme.importPath).toContain("/@fs/");
    expect(theme.filePath).toContain("theme-minimal");
  });
});

test("resolveSlidaTheme resolves npm themes from the project root", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeThemePackage(projectRoot, "@acme/slida-theme");

    const theme = await resolveSlidaTheme(projectRoot, "@acme/slida-theme");

    expect(theme).toMatchObject({
      name: "@acme/slida-theme",
      source: "package",
    });
    expect(theme.importPath).toContain("/@fs/");
    expect(theme.filePath).toBe(
      await realpath(join(projectRoot, "node_modules", "@acme", "slida-theme", "theme.css")),
    );
  });
});

test("resolveSlidaTheme rejects empty themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveSlidaTheme(projectRoot, " ")).rejects.toThrow(
      /Slida theme must not be an empty string/,
    );
  });
});

test("resolveSlidaTheme rejects missing npm themes with built-in guidance", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveSlidaTheme(projectRoot, "missing-theme")).rejects.toThrow(
      /Built-in themes: default, minimal, bold/,
    );
  });
});

test("createSlidaAstroConfig resolves config theme before Astro starts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { theme: 'bold' };\n");

    const { slidaTheme } = await createSlidaAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(slidaTheme).toMatchObject({ name: "bold", source: "builtin" });
  });
});

test("no config preserves the default dev port", () => {
  const config = createAstroInlineConfig(testPaths());
  expect(serverPort(config)).toBe(DEFAULT_DEV_PORT);
});

test("no config does not install Tailwind as a built-in Vite plugin", () => {
  const config = createAstroInlineConfig(testPaths());
  expect(config.vite?.plugins).toEqual([]);
});

test("theme CSS import is generated before the Astro deck import", async () => {
  const paths = testPaths();
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.astro"),
    projectRelativePath: "slides/deck.astro",
    format: "astro" as const,
  };
  await mkdir(dirname(deck.filePath), { recursive: true });
  await writeFile(
    deck.filePath,
    `---\nimport Page from "@slida/cli/page";\n---\n\n<Page><h1>Deck</h1></Page>\n`,
  );

  const code = await loadVirtualDeckModule(
    createAstroInlineConfig(paths, {}, {}, deck, {
      name: "minimal",
      importPath: "/@fs/tmp/slida-theme-minimal/style.css",
      filePath: "/tmp/slida-theme-minimal/style.css",
      source: "builtin",
    }),
  );

  expect(code.indexOf("/@fs/tmp/slida-theme-minimal/style.css")).toBeLessThan(
    code.indexOf("/slides/deck.astro"),
  );
});

test("user Astro config appends without replacing Slida-owned values", () => {
  const paths = testPaths();
  const userIntegration = { name: "user-integration", hooks: {} } as never;
  const userPlugin = { name: "user-plugin" } as never;
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.astro"),
    projectRelativePath: "slides/deck.astro",
    format: "astro" as const,
  };
  const config = createAstroInlineConfig(
    paths,
    {},
    {
      astro: {
        integrations: [userIntegration],
        vite: {
          root: join(paths.projectRoot, "other-root"),
          plugins: [userPlugin],
          resolve: {
            alias: [{ find: /^@slides$/, replacement: join(paths.projectRoot, "slides") }],
          },
          server: {
            fs: {
              strict: false,
              allow: [join(paths.projectRoot, "content")],
            },
          },
        },
      },
    },
    deck,
    {
      name: "bold",
      importPath: "/@fs/tmp/slida-theme-bold/style.css",
      filePath: "/tmp/slida-theme-bold/style.css",
      source: "builtin",
    },
  );

  expect(config.root).toBe(paths.projectRoot);
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBe(paths.runtimeOutDir);
  expect(config.output).toBe("static");
  expect(config.integrations?.at(-1)).toBe(userIntegration);
  expect(vitePlugins(config)[0]?.name).toBe("slida:virtual-deck");
  expect(config.vite?.plugins).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "slida:virtual-deck" })]),
  );
  expect(config.vite?.plugins?.at(-1)).toBe(userPlugin);
  expect(config.vite?.resolve?.alias).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ find: /^astro$/ }),
      expect.objectContaining({ find: /^@slides$/ }),
    ]),
  );
  expect(config.vite?.server?.fs?.allow).toEqual(
    expect.arrayContaining([
      paths.projectRoot,
      paths.runtimeOutDir,
      paths.runtimeSourceDir,
      dirname(deck.filePath),
      "/tmp/slida-theme-bold",
      join(paths.projectRoot, "content"),
    ]),
  );
  expect(config.vite?.server?.fs?.strict).toBe(true);
  expect((config.vite as { root?: unknown }).root).toBeUndefined();
});
