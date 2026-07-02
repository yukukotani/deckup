import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createAstroInlineConfig, createSlidaAstroConfig, DEFAULT_DEV_PORT } from "../src/astro.ts";
import { loadSlidaConfig } from "../src/config.ts";
import { VIRTUAL_SLIDA_THEME_LAYOUTS_ID } from "../src/theme-layouts.ts";
import { resolveSlidaThemeLayouts } from "../src/theme.ts";
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

async function loadVirtualModule(
  config: ReturnType<typeof createAstroInlineConfig>,
  pluginName: string,
  virtualId: string,
) {
  const plugin = vitePlugins(config).find((candidate) => candidate.name === pluginName);
  expect(plugin).toBeDefined();

  const resolvedId = await plugin?.resolveId?.call({}, virtualId);
  expect(typeof resolvedId).toBe("string");

  const watched: string[] = [];
  const loaded = await plugin?.load?.call(
    {
      addWatchFile(filePath: string) {
        watched.push(filePath);
      },
    },
    resolvedId as string,
  );
  expect(typeof loaded).toBe("string");

  return { code: loaded as string, watched };
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

async function writeThemeLayoutPackage(projectRoot: string, packageName: string) {
  const packageDir = join(projectRoot, "node_modules", ...packageName.split("/"));
  const layoutsDir = join(packageDir, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: {
        "./layouts/*.astro": "./layouts/*.astro",
        "./package.json": "./package.json",
      },
    }),
  );
  await writeFile(join(layoutsDir, "cover.astro"), "<slot />\n");
  await writeFile(join(layoutsDir, "default.astro"), "<slot />\n");
  await writeFile(
    join(layoutsDir, "two-column.astro"),
    `<section><slot /><slot name="left" /><slot name="right" /></section>\n`,
  );
}

async function writeMinimalThemeLayoutPackage(projectRoot: string, packageName: string) {
  const packageDir = join(projectRoot, "node_modules", ...packageName.split("/"));
  const layoutsDir = join(packageDir, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: {
        "./layouts/*.astro": "./layouts/*.astro",
        "./package.json": "./package.json",
      },
    }),
  );
  await writeFile(join(layoutsDir, "cover.astro"), "<slot />\n");
  await writeFile(join(layoutsDir, "default.astro"), "<slot />\n");
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

test("resolveSlidaThemeLayouts defaults to the first-party default theme layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveSlidaThemeLayouts(projectRoot, undefined)).resolves.toMatchObject({
      name: "default",
      source: "builtin",
      layouts: expect.arrayContaining([
        expect.objectContaining({ id: "cover" }),
        expect.objectContaining({ id: "default" }),
      ]),
    });
  });
});

test("resolveSlidaThemeLayouts maps built-in short names to first-party theme packages", async () => {
  await withProjectRoot(async (projectRoot) => {
    const theme = await resolveSlidaThemeLayouts(projectRoot, "minimal");

    expect(theme.name).toBe("minimal");
    expect(theme.source).toBe("builtin");
    expect(theme.packageName).toBe("@slida/theme-minimal");
    expect(theme.packageRoot).toContain("theme-minimal");
    expect(theme.layouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "default",
          importPath: expect.stringContaining("/@fs/"),
        }),
      ]),
    );
  });
});

test("resolveSlidaThemeLayouts resolves every built-in theme from layout components", async () => {
  await withProjectRoot(async (projectRoot) => {
    const expectedLayouts = {
      default: ["cover", "default"],
      minimal: ["cover", "default"],
      bold: ["cover", "default"],
      "google-basic": ["cover", "number", "page", "quote", "section", "statement", "two-column"],
      "apple-basic": ["cover", "number", "page", "quote", "section", "statement", "two-column"],
    } as const;

    for (const [themeName, layoutIds] of Object.entries(expectedLayouts)) {
      const theme = await resolveSlidaThemeLayouts(projectRoot, themeName);

      expect(theme.source).toBe("builtin");
      expect(theme.packageName).toBe(`@slida/theme-${themeName}`);
      expect((theme as { importPath?: string }).importPath).toBeUndefined();
      expect(theme.layoutsDir).toBe(join(theme.packageRoot!, "layouts"));
      expect(theme.layouts?.map((layout) => layout.id)).toEqual(layoutIds);
      expect(theme.layouts?.every((layout) => layout.filePath.endsWith(`${layout.id}.astro`))).toBe(
        true,
      );
    }
  });
});

test("resolveSlidaThemeLayouts resolves npm theme layouts from the project root", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeThemeLayoutPackage(projectRoot, "@acme/slida-layout-theme");

    const theme = await resolveSlidaThemeLayouts(projectRoot, "@acme/slida-layout-theme");

    expect(theme).toMatchObject({
      name: "@acme/slida-layout-theme",
      packageName: "@acme/slida-layout-theme",
      source: "package",
      slotNames: ["left", "right"],
    });
    expect(theme.packageRoot).toBe(
      await realpath(join(projectRoot, "node_modules", "@acme", "slida-layout-theme")),
    );
    expect(theme.layouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cover",
          filePath: await realpath(
            join(
              projectRoot,
              "node_modules",
              "@acme",
              "slida-layout-theme",
              "layouts",
              "cover.astro",
            ),
          ),
          importPath: expect.stringContaining("/@fs/"),
          slotNames: [],
        }),
        expect.objectContaining({
          id: "two-column",
          slotNames: ["left", "right"],
        }),
      ]),
    );
  });
});

test("resolveSlidaThemeLayouts rejects CSS-only npm themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    const packageDir = join(projectRoot, "node_modules", "css-only-theme");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "css-only-theme", type: "module", exports: { ".": "./style.css" } }),
    );
    await writeFile(join(packageDir, "style.css"), ":root { --slida-accent: tomato; }\n");

    await expect(resolveSlidaThemeLayouts(projectRoot, "css-only-theme")).rejects.toThrow(
      /export \.\/package\.json plus Astro layout components/,
    );
  });
});

test("createSlidaAstroConfig rejects CSS-only configured theme packages", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeThemePackage(projectRoot, "css-only-theme");
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default { theme: 'css-only-theme' };\n",
    );

    await expect(
      createSlidaAstroConfig({ root: projectRoot, deckFile: "slides/deck.astro" }),
    ).rejects.toThrow(/export \.\/package\.json plus Astro layout components/);
  });
});

test("resolveSlidaThemeLayouts rejects empty themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveSlidaThemeLayouts(projectRoot, " ")).rejects.toThrow(
      /Slida theme must not be an empty string/,
    );
  });
});

test("resolveSlidaThemeLayouts rejects missing npm themes with built-in guidance", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveSlidaThemeLayouts(projectRoot, "missing-theme")).rejects.toThrow(
      /Built-in themes: default, minimal, bold, google-basic, apple-basic/,
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

test("layout theme module is imported before the Astro deck and watches layout files", async () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/slida-project/.slida/runtime/generated/Page.astro",
  };
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.astro"),
    projectRelativePath: "slides/deck.astro",
    format: "astro" as const,
  };
  const defaultLayout = "/tmp/slida-layout-theme/layouts/default.astro";
  const coverLayout = "/tmp/slida-layout-theme/layouts/cover.astro";
  const twoColumnLayout = "/tmp/slida-layout-theme/layouts/two-column.astro";
  await mkdir(dirname(deck.filePath), { recursive: true });
  await writeFile(
    deck.filePath,
    `---\nimport Page from "@slida/cli/page";\n---\n\n<Page><h1>Deck</h1></Page>\n`,
  );

  const config = createAstroInlineConfig(paths, {}, {}, deck, {
    name: "@acme/slida-layout-theme",
    filePath: "/tmp/slida-layout-theme/package.json",
    layoutsDir: "/tmp/slida-layout-theme/layouts",
    layouts: [
      {
        id: "cover",
        filePath: coverLayout,
        importPath: "/@fs/tmp/slida-layout-theme/layouts/cover.astro",
        slotNames: [],
      },
      {
        id: "default",
        filePath: defaultLayout,
        importPath: "/@fs/tmp/slida-layout-theme/layouts/default.astro",
        slotNames: [],
      },
      {
        id: "two-column",
        filePath: twoColumnLayout,
        importPath: "/@fs/tmp/slida-layout-theme/layouts/two-column.astro",
        slotNames: ["left", "right"],
      },
    ],
    slotNames: ["left", "right"],
    source: "package",
  });

  const deckModule = await loadVirtualModule(config, "slida:virtual-deck", "virtual:slida/deck");
  const layoutsModule = await loadVirtualModule(
    config,
    "slida:virtual-theme-layouts",
    VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  );

  expect(deckModule.code.indexOf(VIRTUAL_SLIDA_THEME_LAYOUTS_ID)).toBeLessThan(
    deckModule.code.indexOf("/slides/deck.astro"),
  );
  expect(deckModule.watched).toEqual(
    expect.arrayContaining([
      deck.filePath,
      "/tmp/slida-layout-theme/package.json",
      "/tmp/slida-layout-theme/layouts",
      coverLayout,
    ]),
  );
  expect(layoutsModule.code).toContain("Layout0");
  expect(layoutsModule.code).toContain('"two-column": Layout2');
  expect(layoutsModule.watched).toEqual(
    expect.arrayContaining(["/tmp/slida-layout-theme/layouts", coverLayout, twoColumnLayout]),
  );
});

test("layout theme module is imported before the MDX deck and validates layout ids", async () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/slida-project/.slida/runtime/generated/Page.astro",
  };
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.mdx"),
    projectRelativePath: "slides/deck.mdx",
    format: "mdx" as const,
  };
  const defaultLayout = "/tmp/slida-layout-theme/layouts/default.astro";
  const coverLayout = "/tmp/slida-layout-theme/layouts/cover.astro";
  await mkdir(dirname(deck.filePath), { recursive: true });
  await writeFile(deck.filePath, `---\ntitle: MDX Deck\n---\n\n<layout id="cover" />\n\n# Deck\n`);

  const config = createAstroInlineConfig(paths, {}, {}, deck, {
    name: "@acme/slida-layout-theme",
    filePath: "/tmp/slida-layout-theme/package.json",
    layoutsDir: "/tmp/slida-layout-theme/layouts",
    layouts: [
      {
        id: "cover",
        filePath: coverLayout,
        importPath: "/@fs/tmp/slida-layout-theme/layouts/cover.astro",
        slotNames: [],
      },
      {
        id: "default",
        filePath: defaultLayout,
        importPath: "/@fs/tmp/slida-layout-theme/layouts/default.astro",
        slotNames: [],
      },
    ],
    slotNames: [],
    source: "package",
  });

  const deckModule = await loadVirtualModule(config, "slida:virtual-deck", "virtual:slida/deck");

  expect(deckModule.code.indexOf(VIRTUAL_SLIDA_THEME_LAYOUTS_ID)).toBeLessThan(
    deckModule.code.indexOf("/slides/deck.mdx"),
  );
  expect(deckModule.code).toContain('import Deck, { frontmatter } from "/slides/deck.mdx"');
  expect(deckModule.watched).toEqual(
    expect.arrayContaining([
      deck.filePath,
      "/tmp/slida-layout-theme/package.json",
      "/tmp/slida-layout-theme/layouts",
      coverLayout,
    ]),
  );
});

test("layout themes add generated Page alias and layout fs allow entry", () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/slida-project/.slida/runtime/generated/Page.astro",
  };
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.astro"),
    projectRelativePath: "slides/deck.astro",
    format: "astro" as const,
  };
  const config = createAstroInlineConfig(paths, {}, {}, deck, {
    name: "@acme/slida-layout-theme",
    filePath: "/tmp/slida-layout-theme/package.json",
    layoutsDir: "/tmp/slida-layout-theme/layouts",
    layouts: [
      {
        id: "default",
        filePath: "/tmp/slida-layout-theme/layouts/default.astro",
        importPath: "/@fs/tmp/slida-layout-theme/layouts/default.astro",
        slotNames: [],
      },
    ],
    slotNames: [],
    source: "package",
  });

  expect(config.vite?.resolve?.alias).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        find: /^@slida\/cli\/page$/,
        replacement: paths.generatedPageFilePath,
      }),
    ]),
  );
  expect(config.vite?.server?.fs?.allow).toEqual(
    expect.arrayContaining(["/tmp/slida-layout-theme", "/tmp/slida-layout-theme/layouts"]),
  );
});

test("generated Page paths do not alias @slida/cli/page without layout themes", () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/slida-project/.slida/runtime/generated/Page.astro",
  };
  const config = createAstroInlineConfig(paths);

  expect(config.vite?.resolve?.alias).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ find: /^@slida\/cli\/page$/ })]),
  );
});

test("createAstroInlineConfig rejects non-layout theme objects", () => {
  const paths = testPaths();
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.astro"),
    projectRelativePath: "slides/deck.astro",
    format: "astro" as const,
  };
  expect(() =>
    createAstroInlineConfig(paths, {}, {}, deck, {
      name: "legacy-css-theme",
      importPath: "/@fs/tmp/legacy-css-theme/theme.css",
      filePath: "/tmp/legacy-css-theme/theme.css",
      source: "package",
    }),
  ).toThrow(/must resolve from layouts\/\*\.astro/);
});

test("createAstroInlineConfig rejects layout themes without generated Page aliasing", () => {
  const paths = testPaths();
  const deck = {
    filePath: join(paths.projectRoot, "slides", "deck.astro"),
    projectRelativePath: "slides/deck.astro",
    format: "astro" as const,
  };

  expect(() =>
    createAstroInlineConfig(paths, {}, {}, deck, {
      name: "@acme/slida-layout-theme",
      filePath: "/tmp/slida-layout-theme/package.json",
      layoutsDir: "/tmp/slida-layout-theme/layouts",
      layouts: [
        {
          id: "default",
          filePath: "/tmp/slida-layout-theme/layouts/default.astro",
          importPath: "/@fs/tmp/slida-layout-theme/layouts/default.astro",
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "package",
    }),
  ).toThrow(/requires a generated Page component/);
});

test("createSlidaAstroConfig writes generated Page for layout themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeThemeLayoutPackage(projectRoot, "@acme/slida-layout-theme");
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default { theme: '@acme/slida-layout-theme' };\n",
    );

    const { astroConfig, paths } = await createSlidaAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(paths.generatedPageFilePath).toBe(
      join(await realpath(projectRoot), ".slida/runtime/generated/Page.astro"),
    );
    expect(paths.generatedPageFilePath).toBeDefined();
    expect(await readFile(paths.generatedPageFilePath!, "utf8")).toContain(
      VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
    );
    expect(await readFile(paths.generatedPageFilePath!, "utf8")).toContain(
      '<slot name="left" slot="left" />',
    );
    expect(astroConfig.vite?.resolve?.alias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replacement: paths.generatedPageFilePath }),
      ]),
    );
  });
});

test("virtual layout registry re-discovers layouts added after config creation", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeMinimalThemeLayoutPackage(projectRoot, "@acme/slida-layout-theme");
    const theme = await resolveSlidaThemeLayouts(projectRoot, "@acme/slida-layout-theme");
    const paths = {
      ...testPaths(projectRoot),
      generatedPageFilePath: join(projectRoot, ".slida/runtime/generated/Page.astro"),
    };
    const deck = {
      filePath: join(projectRoot, "slides", "deck.astro"),
      projectRelativePath: "slides/deck.astro",
      format: "astro" as const,
    };
    await mkdir(dirname(deck.filePath), { recursive: true });
    await writeFile(
      deck.filePath,
      `---\nimport Page from "@slida/cli/page";\n---\n\n<Page><layout id="speaker" /><h1>Deck</h1></Page>\n`,
    );
    await writeFile(join(theme.layoutsDir!, "speaker.astro"), "<slot />\n");

    const config = createAstroInlineConfig(paths, {}, {}, deck, theme);
    const deckModule = await loadVirtualModule(config, "slida:virtual-deck", "virtual:slida/deck");

    expect(deckModule.code).toContain("slides/deck.astro");
    expect(deckModule.watched).toEqual(
      expect.arrayContaining([theme.layoutsDir, join(theme.layoutsDir!, "speaker.astro")]),
    );
  });
});

test("virtual layout registry rejects layouts removed after config creation", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeMinimalThemeLayoutPackage(projectRoot, "@acme/slida-layout-theme");
    const speakerLayout = join(
      projectRoot,
      "node_modules",
      "@acme",
      "slida-layout-theme",
      "layouts",
      "speaker.astro",
    );
    await writeFile(speakerLayout, "<slot />\n");
    const theme = await resolveSlidaThemeLayouts(projectRoot, "@acme/slida-layout-theme");
    const paths = {
      ...testPaths(projectRoot),
      generatedPageFilePath: join(projectRoot, ".slida/runtime/generated/Page.astro"),
    };
    const deck = {
      filePath: join(projectRoot, "slides", "deck.astro"),
      projectRelativePath: "slides/deck.astro",
      format: "astro" as const,
    };
    await mkdir(dirname(deck.filePath), { recursive: true });
    await writeFile(
      deck.filePath,
      `---\nimport Page from "@slida/cli/page";\n---\n\n<Page><layout id="speaker" /><h1>Deck</h1></Page>\n`,
    );
    await unlink(speakerLayout);

    const config = createAstroInlineConfig(paths, {}, {}, deck, theme);

    await expect(
      loadVirtualModule(config, "slida:virtual-deck", "virtual:slida/deck"),
    ).rejects.toThrow(/does not provide layout "speaker"/);
  });
});

test("virtual layout registry refreshes generated Page slot forwarding", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeThemeLayoutPackage(projectRoot, "@acme/slida-layout-theme");
    const theme = await resolveSlidaThemeLayouts(projectRoot, "@acme/slida-layout-theme");
    const paths = {
      ...testPaths(projectRoot),
      generatedPageFilePath: join(projectRoot, ".slida/runtime/generated/Page.astro"),
    };
    const deck = {
      filePath: join(projectRoot, "slides", "deck.astro"),
      projectRelativePath: "slides/deck.astro",
      format: "astro" as const,
    };
    await mkdir(dirname(deck.filePath), { recursive: true });
    await writeFile(
      deck.filePath,
      `---\nimport Page from "@slida/cli/page";\n---\n\n<Page><h1>Deck</h1></Page>\n`,
    );
    const config = createAstroInlineConfig(paths, {}, {}, deck, theme);

    await loadVirtualModule(config, "slida:virtual-theme-layouts", VIRTUAL_SLIDA_THEME_LAYOUTS_ID);
    expect(await readFile(paths.generatedPageFilePath, "utf8")).toContain(
      '<slot name="left" slot="left" />',
    );

    await writeFile(
      join(theme.layoutsDir!, "two-column.astro"),
      `<section><slot /><slot name="speaker" /></section>\n`,
    );

    await loadVirtualModule(config, "slida:virtual-theme-layouts", VIRTUAL_SLIDA_THEME_LAYOUTS_ID);
    const generatedPage = await readFile(paths.generatedPageFilePath, "utf8");
    expect(generatedPage).toContain('<slot name="speaker" slot="speaker" />');
    expect(generatedPage).not.toContain('<slot name="left" slot="left" />');
  });
});

test("user Astro config appends without replacing Slida-owned values", () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/slida-project/.slida/runtime/generated/Page.astro",
  };
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
      filePath: "/tmp/slida-theme-bold/package.json",
      layoutsDir: "/tmp/slida-theme-bold/layouts",
      layouts: [
        {
          id: "cover",
          filePath: "/tmp/slida-theme-bold/layouts/cover.astro",
          importPath: "/@fs/tmp/slida-theme-bold/layouts/cover.astro",
          slotNames: [],
        },
        {
          id: "default",
          filePath: "/tmp/slida-theme-bold/layouts/default.astro",
          importPath: "/@fs/tmp/slida-theme-bold/layouts/default.astro",
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "builtin",
    },
  );

  expect(config.root).toBe(paths.projectRoot);
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBe(paths.runtimeOutDir);
  expect(config.output).toBe("static");
  expect(config.integrations?.at(-1)).toBe(userIntegration);
  expect(vitePlugins(config)[0]?.name).toBe("slida:virtual-theme-layouts");
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
      "/tmp/slida-theme-bold/layouts",
      join(paths.projectRoot, "content"),
    ]),
  );
  expect(config.vite?.server?.fs?.strict).toBe(true);
  expect((config.vite as { root?: unknown }).root).toBeUndefined();
});
