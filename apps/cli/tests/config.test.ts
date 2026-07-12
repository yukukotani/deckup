import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";

import {
  createAstroInlineConfig,
  createMarkdownConfig,
  createDeckupAstroConfig,
  DEFAULT_DEV_PORT,
  resolveRawAstroCodeHighlightOptions,
} from "../src/astro.ts";
import { loadDeckupConfig } from "../src/config.ts";
import { createDeckupCliIntegration } from "../src/integration.ts";
import {
  getNpmThemeCacheEntryDir,
  parseNpmThemeSource,
  resolveCachedNpmThemePackage,
  DECKUP_THEME_CACHE_ENV,
  type NpmThemeInstallOperations,
  type DeckupNpmThemeSource,
} from "../src/npm-theme.ts";
import {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  createSingleDeckRegistry,
  normalizePath,
  resolveDeckFile,
} from "@deckup/core";
import { resolveDeckupThemeLayouts } from "../src/theme.ts";
import type { DeckupRuntimePaths } from "../src/types.ts";

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-config-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

function testPaths(projectRoot = resolve("/tmp/deckup-project")): DeckupRuntimePaths {
  return {
    projectRoot,
    runtimeSourceDir: join(projectRoot, "node_modules/deckup/runtime"),
    runtimeOutDir: join(projectRoot, ".deckup/runtime"),
  };
}

function serverPort(config: ReturnType<typeof createAstroInlineConfig>) {
  return (config.server as { port?: number } | undefined)?.port;
}

function markdownConfig(config: ReturnType<typeof createAstroInlineConfig>) {
  return config.markdown as {
    syntaxHighlight?: unknown;
    shikiConfig?: Record<string, unknown>;
  };
}

async function writeAstroDeck(
  projectRoot: string,
  source = `---
import Page from "@deckup/astro/page";
---

<Page><h1>Deck</h1></Page>
`,
) {
  await mkdir(join(projectRoot, "slides"));
  await writeFile(join(projectRoot, "slides", "deck.astro"), source);
}

async function writeThemePackage(projectRoot: string, packageName: string) {
  const packageDir = join(projectRoot, "node_modules", ...packageName.split("/"));
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: packageName, type: "module", exports: { ".": "./theme.css" } }),
  );
  await writeFile(join(packageDir, "theme.css"), ":root { --deckup-accent: tomato; }\n");
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

async function withThemeCache(run: (cacheDir: string) => Promise<void>) {
  const cacheDir = await mkdtemp(join(tmpdir(), "deckup-npm-theme-cache-"));
  try {
    await run(cacheDir);
  } finally {
    await rm(cacheDir, { force: true, recursive: true });
  }
}

let processGlobalMutationLock: Promise<void> = Promise.resolve();

async function withSerializedProcessGlobals<T>(run: () => Promise<T>): Promise<T> {
  const previousLock = processGlobalMutationLock;
  let releaseCurrentLock!: () => void;
  processGlobalMutationLock = new Promise<void>((resolve) => {
    releaseCurrentLock = resolve;
  });
  await previousLock;
  try {
    return await run();
  } finally {
    releaseCurrentLock();
  }
}

async function withNpmThemeCacheEnv(cacheDir: string, run: () => Promise<void>) {
  const previousCacheDir = process.env[DECKUP_THEME_CACHE_ENV];
  process.env[DECKUP_THEME_CACHE_ENV] = cacheDir;
  try {
    await run();
  } finally {
    if (previousCacheDir === undefined) {
      delete process.env[DECKUP_THEME_CACHE_ENV];
    } else {
      process.env[DECKUP_THEME_CACHE_ENV] = previousCacheDir;
    }
  }
}

async function writeCachedThemePackage(
  packageRoot: string,
  packageName: string,
  version = "1.0.0",
) {
  const layoutsDir = join(packageRoot, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
      type: "module",
      exports: {
        "./layouts/*.astro": "./layouts/*.astro",
        "./package.json": "./package.json",
      },
    }),
  );
  await writeFile(join(layoutsDir, "default.astro"), "<slot />\n");
}

async function writeCachedThemeMetadata(
  cacheEntryDir: string,
  source: DeckupNpmThemeSource,
  version = "1.0.0",
) {
  await writeFile(
    join(cacheEntryDir, "deckup-npm-theme.json"),
    `${JSON.stringify(
      {
        source: source.originalName,
        spec: source.spec,
        packageName: source.packageName,
        version,
      },
      null,
      2,
    )}\n`,
  );
}

function fakeNpmThemeOperations(packageName: string, version = "1.0.0", calls: string[] = []) {
  return {
    async manifest(spec, options) {
      calls.push(`manifest:${spec}:${options.cache}`);
      return {
        name: packageName,
        version,
        dist: {
          integrity: "sha512-test-integrity",
          tarball: `https://registry.example.test/${packageName.replace("/", "-")}-${version}.tgz`,
        },
      };
    },
    async extract(spec, target, options) {
      calls.push(`extract:${spec}:${options.cache}:${options.integrity ?? "none"}`);
      await writeCachedThemePackage(target, packageName, version);
      return { from: spec, resolved: spec, integrity: options.integrity };
    },
  } satisfies NpmThemeInstallOperations;
}

async function withNonInteractiveStdio(run: () => Promise<void>) {
  const restorers: Array<() => void> = [];
  try {
    const inputIsTty = Object.getOwnPropertyDescriptor(input, "isTTY");
    Object.defineProperty(input, "isTTY", { configurable: true, value: false });
    restorers.push(() => {
      if (inputIsTty) Object.defineProperty(input, "isTTY", inputIsTty);
      else delete (input as { isTTY?: boolean }).isTTY;
    });

    const outputIsTty = Object.getOwnPropertyDescriptor(output, "isTTY");
    Object.defineProperty(output, "isTTY", { configurable: true, value: false });
    restorers.push(() => {
      if (outputIsTty) Object.defineProperty(output, "isTTY", outputIsTty);
      else delete (output as { isTTY?: boolean }).isTTY;
    });

    await run();
  } finally {
    for (const restore of restorers.reverse()) restore();
  }
}

test("parseNpmThemeSource accepts bare and exact npm theme specs", () => {
  expect(parseNpmThemeSource("minimal")).toBeUndefined();
  expect(parseNpmThemeSource("npm:@acme/deckup-theme")).toEqual({
    originalName: "npm:@acme/deckup-theme",
    spec: "@acme/deckup-theme",
    packageName: "@acme/deckup-theme",
    version: undefined,
  });
  expect(parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")).toEqual({
    originalName: "npm:@acme/deckup-theme@1.2.3",
    spec: "@acme/deckup-theme@1.2.3",
    packageName: "@acme/deckup-theme",
    version: "1.2.3",
  });
});

test("parseNpmThemeSource rejects unsupported npm theme specs", () => {
  expect(() => parseNpmThemeSource("npm:")).toThrow(/must include a package name/);
  expect(() => parseNpmThemeSource("npm:@acme/deckup-theme@^1.0.0")).toThrow(
    /must use npm:package or npm:package@version/,
  );
  expect(() => parseNpmThemeSource("npm:github:user/repo")).toThrow(
    /must reference an npm registry package|Invalid Deckup npm theme spec/,
  );
});

test("loadDeckupConfig loads a project-root TypeScript config", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "deckup.config.ts"), "export default { port: 3000 };\n");

    await expect(loadDeckupConfig(projectRoot)).resolves.toMatchObject({
      config: { port: 3000 },
      filePath: join(projectRoot, "deckup.config.ts"),
    });
  });
});

test("loadDeckupConfig returns an empty config when no config file exists", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(loadDeckupConfig(projectRoot)).resolves.toEqual({ config: {} });
  });
});

test("loadDeckupConfig rejects multiple project-root config files", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "deckup.config.ts"), "export default { port: 3000 };\n");
    await writeFile(join(projectRoot, "deckup.config.js"), "export default { port: 3001 };\n");

    await expect(loadDeckupConfig(projectRoot)).rejects.toThrow(
      /Multiple Deckup config files found/,
    );
  });
});

test("loadDeckupConfig rejects non-object config exports", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default () => ({ port: 3000 });\n",
    );

    await expect(loadDeckupConfig(projectRoot)).rejects.toThrow(
      /Deckup config must default-export an object/,
    );
  });
});

test("createDeckupAstroConfig uses config port when CLI/API port is omitted", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(join(projectRoot, "deckup.config.ts"), "export default { port: 3000 };\n");

    const { astroConfig, deckupConfigFile } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(serverPort(astroConfig)).toBe(3000);
    expect(deckupConfigFile).toBe(await realpath(join(projectRoot, "deckup.config.ts")));
  });
});

test("explicit API port wins over config port", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(join(projectRoot, "deckup.config.ts"), "export default { port: 3000 };\n");

    const { astroConfig } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      port: 3333,
    });

    expect(serverPort(astroConfig)).toBe(3333);
  });
});

test("resolveDeckupThemeLayouts defaults to the first-party default theme layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckupThemeLayouts(projectRoot, undefined)).resolves.toMatchObject({
      name: "default",
      source: "builtin",
      layouts: expect.arrayContaining([
        expect.objectContaining({ id: "cover" }),
        expect.objectContaining({ id: "default" }),
      ]),
    });
  });
});

test("resolveDeckupThemeLayouts maps built-in short names to first-party theme packages", async () => {
  await withProjectRoot(async (projectRoot) => {
    const theme = await resolveDeckupThemeLayouts(projectRoot, "minimal", {
      sourceMode: "installed",
    });

    expect(theme.name).toBe("minimal");
    expect(theme.source).toBe("builtin");
    expect(theme.packageName).toBe("@deckup/theme-minimal");
    expect(theme.packageRoot).toContain("theme-minimal");
    expect(theme.layouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "default",
          hasDefaultSlot: true,
          importPath: expect.stringContaining("/@fs/"),
        }),
      ]),
    );
  });
});

test("resolveDeckupThemeLayouts resolves every built-in theme from layout components", async () => {
  await withProjectRoot(async (projectRoot) => {
    const expectedLayouts = {
      default: [
        "cover",
        "default",
        "number",
        "page",
        "quote",
        "section",
        "statement",
        "two-column",
      ],
      minimal: [
        "cover",
        "default",
        "number",
        "page",
        "quote",
        "section",
        "statement",
        "two-column",
      ],
      "google-basic": ["cover", "number", "page", "quote", "section", "statement", "two-column"],
      "apple-basic": ["cover", "number", "page", "quote", "section", "statement", "two-column"],
    } as const;

    for (const [themeName, layoutIds] of Object.entries(expectedLayouts)) {
      const theme = await resolveDeckupThemeLayouts(projectRoot, themeName);

      expect(theme.source).toBe("builtin");
      expect(theme.packageName).toBe(`@deckup/theme-${themeName}`);
      expect((theme as { importPath?: string }).importPath).toBeUndefined();
      expect(theme.layoutsDir).toBe(join(theme.packageRoot!, "layouts"));
      expect(theme.layouts?.map((layout) => layout.id)).toEqual(layoutIds);
      expect(theme.layouts?.every((layout) => layout.filePath.endsWith(`${layout.id}.astro`))).toBe(
        true,
      );
    }
  });
});

test("resolveDeckupThemeLayouts resolves installed theme layouts from the project root", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeThemeLayoutPackage(projectRoot, "@acme/deckup-layout-theme");

    const theme = await resolveDeckupThemeLayouts(projectRoot, "@acme/deckup-layout-theme", {
      sourceMode: "installed",
    });

    expect(theme).toMatchObject({
      name: "@acme/deckup-layout-theme",
      packageName: "@acme/deckup-layout-theme",
      source: "package",
      slotNames: ["left", "right"],
    });
    expect(theme.packageRoot).toBe(
      await realpath(join(projectRoot, "node_modules", "@acme", "deckup-layout-theme")),
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
              "deckup-layout-theme",
              "layouts",
              "cover.astro",
            ),
          ),
          importPath: expect.stringContaining("/@fs/"),
          hasDefaultSlot: true,
          slotNames: [],
        }),
        expect.objectContaining({
          id: "two-column",
          hasDefaultSlot: true,
          slotNames: ["left", "right"],
        }),
      ]),
    );
  });
});

test("resolveDeckupThemeLayouts installed mode rejects normalized npm sources before cache work", async () => {
  await withProjectRoot(async (projectRoot) => {
    await withThemeCache(async (cacheDir) => {
      await withSerializedProcessGlobals(() =>
        withNpmThemeCacheEnv(cacheDir, async () => {
          await expect(
            resolveDeckupThemeLayouts(projectRoot, "  npm:@acme/deckup-theme@1.2.3  ", {
              sourceMode: "installed",
            }),
          ).rejects.toThrow(/only supports built-in themes and installed packages/);
          await expect(readdir(cacheDir)).resolves.toEqual([]);
        }),
      );
    });
  });
});

test("resolveDeckupThemeLayouts resolves npm theme layouts from the Deckup cache", async () => {
  await withProjectRoot(async (projectRoot) => {
    await withThemeCache(async (cacheDir) => {
      const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
      const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
      await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.2.3");
      await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");

      await withSerializedProcessGlobals(() =>
        withNpmThemeCacheEnv(cacheDir, async () => {
          const theme = await resolveDeckupThemeLayouts(
            projectRoot,
            "npm:@acme/deckup-theme@1.2.3",
          );

          expect(theme).toMatchObject({
            name: "npm:@acme/deckup-theme@1.2.3",
            packageName: "@acme/deckup-theme",
            source: "package",
            slotNames: [],
          });
          expect(theme.packageRoot).toBe(await realpath(join(cacheEntryDir, "package")));
          expect(theme.layoutsDir).toBe(join(theme.packageRoot!, "layouts"));
          expect(theme.layouts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: "default",
                importPath: expect.stringContaining("/@fs/"),
              }),
            ]),
          );
        }),
      );
    });
  });
});

test("resolveDeckupThemeLayouts rejects CSS-only npm themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    const packageDir = join(projectRoot, "node_modules", "css-only-theme");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "css-only-theme", type: "module", exports: { ".": "./style.css" } }),
    );
    await writeFile(join(packageDir, "style.css"), ":root { --deckup-accent: tomato; }\n");

    await expect(resolveDeckupThemeLayouts(projectRoot, "css-only-theme")).rejects.toThrow(
      /export \.\/package\.json plus Astro layout components/,
    );
  });
});

test("createDeckupAstroConfig rejects CSS-only configured theme packages", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeThemePackage(projectRoot, "css-only-theme");
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'css-only-theme' };\n",
    );

    await expect(
      createDeckupAstroConfig({ root: projectRoot, deckFile: "slides/deck.astro" }),
    ).rejects.toThrow(/export \.\/package\.json plus Astro layout components/);
  });
});

test("resolveDeckupThemeLayouts rejects empty themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckupThemeLayouts(projectRoot, " ")).rejects.toThrow(
      /Deckup theme must not be an empty string/,
    );
  });
});

test("resolveDeckupThemeLayouts rejects missing npm themes with built-in guidance", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckupThemeLayouts(projectRoot, "missing-theme")).rejects.toThrow(
      /Built-in themes: default, minimal, google-basic, apple-basic/,
    );
  });
});

test("resolveCachedNpmThemePackage downloads approved missing themes into the cache", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const calls: string[] = [];
    const confirmations: unknown[] = [];

    const resolved = await resolveCachedNpmThemePackage(source, {
      cacheDir,
      confirmDownload: async (request) => {
        confirmations.push(request);
        calls.push(`confirm:${request.spec}:${request.cacheDir}`);
        return true;
      },
      operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls),
    });

    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    expect(confirmations).toEqual([
      { spec: "@acme/deckup-theme@1.2.3", packageName: "@acme/deckup-theme", cacheDir },
    ]);
    expect(calls).toEqual([
      `confirm:@acme/deckup-theme@1.2.3:${cacheDir}`,
      expect.stringContaining("manifest:@acme/deckup-theme@1.2.3:"),
      expect.stringContaining(
        "extract:https://registry.example.test/@acme-deckup-theme-1.2.3.tgz:",
      ),
    ]);
    expect(calls[2]).toContain("sha512-test-integrity");
    expect(resolved).toMatchObject({
      packageName: "@acme/deckup-theme",
      packageRoot: await realpath(join(cacheEntryDir, "package")),
      version: "1.2.3",
      source: "package",
    });
    await expect(readFile(join(cacheEntryDir, "deckup-npm-theme.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(
        {
          source: "npm:@acme/deckup-theme@1.2.3",
          spec: "@acme/deckup-theme@1.2.3",
          packageName: "@acme/deckup-theme",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
    );
  });
});

test("resolveCachedNpmThemePackage reuses valid cached themes without prompting", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.2.3");
    await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");

    const resolved = await resolveCachedNpmThemePackage(source, {
      cacheDir,
      confirmDownload: async () => {
        throw new Error("cache hits must not prompt");
      },
      operations: {
        async manifest() {
          throw new Error("cache hits must not fetch manifests");
        },
        async extract() {
          throw new Error("cache hits must not extract packages");
        },
      },
    });

    expect(resolved.packageRoot).toBe(await realpath(join(cacheEntryDir, "package")));
  });
});

test("resolveCachedNpmThemePackage repairs invalid cache entries before downloading", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await mkdir(cacheEntryDir, { recursive: true });
    await writeFile(join(cacheEntryDir, "deckup-npm-theme.json"), "{}\n");

    const calls: string[] = [];
    const resolved = await resolveCachedNpmThemePackage(source, {
      cacheDir,
      confirmDownload: async () => true,
      operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls),
    });

    expect(calls).toEqual([
      expect.stringContaining("manifest:@acme/deckup-theme@1.2.3:"),
      expect.stringContaining(
        "extract:https://registry.example.test/@acme-deckup-theme-1.2.3.tgz:",
      ),
    ]);
    expect(resolved.packageRoot).toBe(await realpath(join(cacheEntryDir, "package")));
  });
});

test("resolveCachedNpmThemePackage repairs metadata/package version mismatches before downloading", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.0.0");
    await writeCachedThemeMetadata(cacheEntryDir, source, "2.0.0");

    const calls: string[] = [];
    const resolved = await resolveCachedNpmThemePackage(source, {
      cacheDir,
      confirmDownload: async () => true,
      operations: fakeNpmThemeOperations("@acme/deckup-theme", "2.0.0", calls),
    });

    expect(calls).toEqual([
      expect.stringContaining("manifest:@acme/deckup-theme:"),
      expect.stringContaining(
        "extract:https://registry.example.test/@acme-deckup-theme-2.0.0.tgz:",
      ),
    ]);
    expect(resolved.version).toBe("2.0.0");
  });
});

test("resolveCachedNpmThemePackage serializes same-cache-key repair and download", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await mkdir(cacheEntryDir, { recursive: true });
    await writeFile(join(cacheEntryDir, "deckup-npm-theme.json"), "{}\n");

    let manifestCalls = 0;
    const operations = fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3");
    const wrappedOperations = {
      ...operations,
      async manifest(spec, options) {
        manifestCalls += 1;
        return operations.manifest(spec, options);
      },
    } satisfies NpmThemeInstallOperations;

    const [first, second] = await Promise.all([
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => true,
        operations: wrappedOperations,
      }),
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => true,
        operations: wrappedOperations,
      }),
    ]);

    expect(manifestCalls).toBe(1);
    expect(first.packageRoot).toBe(second.packageRoot);
  });
});

test("resolveCachedNpmThemePackage validates existing cache entry when promotion collides", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    const calls: string[] = [];

    const operations = fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls);
    const resolved = await resolveCachedNpmThemePackage(source, {
      cacheDir,
      confirmDownload: async () => true,
      operations: {
        ...operations,
        async extract(spec, target, options) {
          await operations.extract(spec, target, options);
          await writeCachedThemePackage(
            join(cacheEntryDir, "package"),
            "@acme/deckup-theme",
            "1.2.3",
          );
          await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");
          return { from: spec, resolved: spec, integrity: options.integrity };
        },
      },
    });

    expect(resolved.packageRoot).toBe(await realpath(join(cacheEntryDir, "package")));
    expect(await readdir(join(cacheDir, "tmp"))).toEqual([]);
  });
});

test("resolveCachedNpmThemePackage preserves original errors when temp cleanup fails", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;

    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => true,
        operations: {
          async manifest() {
            return { name: "@acme/deckup-theme", version: "1.2.3" };
          },
          async extract(_spec, target) {
            await rm(target, { force: true, recursive: true });
            await writeFile(target, "not a directory anymore");
            throw new Error("extract failed");
          },
        },
      }),
    ).rejects.toThrow("extract failed");
  });
});

test("resolveCachedNpmThemePackage stops before network work when download is denied", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);

    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => false,
        operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3"),
      }),
    ).rejects.toThrow(/download cancelled/);
    await expect(stat(cacheEntryDir)).rejects.toThrow();
  });
});

test("resolveCachedNpmThemePackage fails uncached non-interactive downloads with guidance", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;

    await withSerializedProcessGlobals(() =>
      withNonInteractiveStdio(async () => {
        await expect(
          resolveCachedNpmThemePackage(source, {
            cacheDir,
            operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3"),
          }),
        ).rejects.toThrow(/Re-run in an interactive terminal to approve the download/);
      }),
    );
  });
});

test("createDeckupAstroConfig resolves config theme before Astro starts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'google-basic' };\n",
    );

    const { deckupTheme } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(deckupTheme).toMatchObject({ name: "google-basic", source: "builtin" });
  });
});

test("createDeckupAstroConfig lets deck theme override config theme before Astro starts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(
      projectRoot,
      `---
import Page from "@deckup/astro/page";
const theme = "minimal";
---

<Page><h1>Deck</h1></Page>
`,
    );
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'google-basic' };\n",
    );

    const { deck, deckupTheme } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(deck?.metadata).toEqual({ theme: "minimal" });
    expect(deckupTheme).toMatchObject({ name: "minimal", source: "builtin" });
  });
});

test("createDeckupAstroConfig reports unresolved deck themes with deck path context", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(
      projectRoot,
      `---
import Page from "@deckup/astro/page";
const theme = "missing-theme";
---

<Page><h1>Deck</h1></Page>
`,
    );
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'default' };\n",
    );

    await expect(
      createDeckupAstroConfig({ root: projectRoot, deckFile: "slides/deck.astro" }),
    ).rejects.toThrow(/Invalid Deckup theme metadata in slides\/deck\.astro/);
  });
});

test("createDeckupAstroConfig wires cached npm themes into generated Page and Vite fs allow", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await withThemeCache(async (cacheDir) => {
      const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
      const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
      await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.2.3");
      await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");
      await writeFile(
        join(projectRoot, "deckup.config.ts"),
        "export default { theme: 'npm:@acme/deckup-theme@1.2.3' };\n",
      );

      await withSerializedProcessGlobals(() =>
        withNpmThemeCacheEnv(cacheDir, async () => {
          const { astroConfig, paths, deckupTheme } = await createDeckupAstroConfig({
            root: projectRoot,
            deckFile: "slides/deck.astro",
          });
          const packageRoot = await realpath(join(cacheEntryDir, "package"));

          expect(deckupTheme).toMatchObject({
            name: "npm:@acme/deckup-theme@1.2.3",
            packageName: "@acme/deckup-theme",
            packageRoot,
            source: "package",
          });
          expect(paths.generatedPageFilePath).toBeDefined();
          expect(await readFile(paths.generatedPageFilePath!, "utf8")).toContain(
            VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
          );
          expect(astroConfig.vite?.server?.fs?.allow).toEqual(
            expect.arrayContaining([packageRoot, join(packageRoot, "layouts")]),
          );
        }),
      );
    });
  });
});

test("CLI integration preserves existing Vite fs allow entries", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    const resolvedProjectRoot = await realpath(projectRoot);
    const deck = await resolveDeckFile(resolvedProjectRoot, "slides/deck.astro");
    const registry = createSingleDeckRegistry(resolvedProjectRoot, deck);
    const integration = createDeckupCliIntegration({ registry });
    const existingAllow = join(resolvedProjectRoot, "content");
    let updatedConfig: { vite?: { server?: { fs?: { allow?: string[] } } } } | undefined;
    const setupHook = (integration.hooks as Record<string, (args: unknown) => Promise<void>>)[
      "astro:config:setup"
    ];

    await setupHook({
      config: {
        root: pathToFileURL(`${resolvedProjectRoot}/`),
        vite: {
          server: {
            fs: {
              allow: [existingAllow],
            },
          },
        },
      },
      injectRoute() {},
      updateConfig(config: typeof updatedConfig) {
        updatedConfig = config;
      },
    });

    expect(updatedConfig?.vite?.server?.fs?.allow).toEqual(
      expect.arrayContaining([normalizePath(existingAllow)]),
    );
  });
});

test("createDeckupAstroConfig fails uncached npm themes before Astro starts in non-interactive mode", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'npm:@acme/deckup-theme@1.2.3' };\n",
    );
    await withThemeCache(async (cacheDir) => {
      await withSerializedProcessGlobals(() =>
        withNpmThemeCacheEnv(cacheDir, () =>
          withNonInteractiveStdio(async () => {
            await expect(
              createDeckupAstroConfig({ root: projectRoot, deckFile: "slides/deck.astro" }),
            ).rejects.toThrow(/Re-run in an interactive terminal to approve the download/);
          }),
        ),
      );
    });
  });
});

test("no config preserves the default dev port", () => {
  const config = createAstroInlineConfig(testPaths());
  expect(serverPort(config)).toBe(DEFAULT_DEV_PORT);
});

test("no config defaults Markdown syntax highlighting to Shiki", () => {
  const config = createAstroInlineConfig(testPaths());

  expect(markdownConfig(config)).toMatchObject({
    syntaxHighlight: "shiki",
    shikiConfig: {},
  });
});

test("user Astro markdown config merges without replacing Shiki config", () => {
  const config = createAstroInlineConfig(
    testPaths(),
    {},
    {
      astro: {
        markdown: {
          shikiConfig: {
            theme: "github-light",
            wrap: true,
          },
        },
      },
    },
  );

  expect(markdownConfig(config)).toMatchObject({
    syntaxHighlight: "shiki",
    shikiConfig: {
      theme: "github-light",
      wrap: true,
    },
  });
});

test("raw Astro code highlighting uses the Markdown Shiki theme subset", () => {
  const markdown = createMarkdownConfig({
    shikiConfig: {
      theme: "github-light",
      wrap: true,
    },
  });

  expect(resolveRawAstroCodeHighlightOptions(markdown)).toEqual({
    enabled: true,
    theme: "github-light",
  });
});

test("raw Astro code highlighting falls back to the Astro default theme", () => {
  const markdown = createMarkdownConfig({
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    },
  });

  expect(resolveRawAstroCodeHighlightOptions(markdown)).toEqual({
    enabled: true,
    theme: "github-dark",
  });
});

test("user Astro markdown syntaxHighlight override disables raw Astro highlighting", () => {
  expect(
    resolveRawAstroCodeHighlightOptions(
      createMarkdownConfig({
        syntaxHighlight: false,
        shikiConfig: {
          theme: "github-light",
        },
      }),
    ),
  ).toEqual({ enabled: false });

  expect(
    resolveRawAstroCodeHighlightOptions(
      createMarkdownConfig({
        syntaxHighlight: "prism",
        shikiConfig: {
          theme: "github-light",
        },
      }),
    ),
  ).toEqual({ enabled: false });
});

test("no config does not install Tailwind as a built-in Vite plugin", () => {
  const config = createAstroInlineConfig(testPaths());
  expect(config.vite?.plugins).toEqual([]);
});

test("generated Page paths do not alias deckup/page without layout themes", () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/deckup-project/.deckup/runtime/generated/Page.astro",
  };
  const config = createAstroInlineConfig(paths);

  expect(config.vite?.resolve?.alias).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ find: /^deckup\/page$/ })]),
  );
});

test("createDeckupAstroConfig writes generated Page for layout themes", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeThemeLayoutPackage(projectRoot, "@acme/deckup-layout-theme");
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: '@acme/deckup-layout-theme' };\n",
    );

    const { astroConfig, paths } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });

    expect(paths.generatedPageFilePath).toBe(
      join(await realpath(projectRoot), ".deckup/generated/Page.astro"),
    );
    expect(paths.generatedPageFilePath).toBeDefined();
    expect(await readFile(paths.generatedPageFilePath!, "utf8")).toContain(
      VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
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

test("user Astro config appends without replacing Deckup-owned values", () => {
  const paths = {
    ...testPaths(),
    generatedPageFilePath: "/tmp/deckup-project/.deckup/runtime/generated/Page.astro",
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
        markdown: {
          shikiConfig: {
            theme: "github-light",
          },
        },
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
      name: "minimal",
      filePath: "/tmp/deckup-theme-minimal/package.json",
      layoutsDir: "/tmp/deckup-theme-minimal/layouts",
      layouts: [
        {
          id: "cover",
          filePath: "/tmp/deckup-theme-minimal/layouts/cover.astro",
          importPath: "/@fs/tmp/deckup-theme-minimal/layouts/cover.astro",
          hasDefaultSlot: true,
          slotNames: [],
        },
        {
          id: "default",
          filePath: "/tmp/deckup-theme-minimal/layouts/default.astro",
          importPath: "/@fs/tmp/deckup-theme-minimal/layouts/default.astro",
          hasDefaultSlot: true,
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "builtin",
    },
  );

  expect(config.root).toBe(paths.projectRoot);
  expect(markdownConfig(config)).toMatchObject({
    syntaxHighlight: "shiki",
    shikiConfig: {
      theme: "github-light",
    },
  });
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBeUndefined();
  expect(config.output).toBe("static");
  expect(config.integrations?.at(-1)).toBe(userIntegration);
  expect(config.vite?.plugins).toEqual([userPlugin]);
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
      dirname(deck.filePath),
      "/tmp/deckup-theme-minimal",
      "/tmp/deckup-theme-minimal/layouts",
      join(paths.projectRoot, "content"),
    ]),
  );
  expect(config.vite?.server?.fs?.strict).toBe(true);
  expect((config.vite as { root?: unknown }).root).toBeUndefined();
});
