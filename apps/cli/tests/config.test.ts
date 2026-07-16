import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";

const configTestRequire = createRequire(import.meta.url);

import {
  createAstroInlineConfig,
  createAstroInlineConfigWithBuiltIns,
  createMarkdownConfig,
  createDeckupAstroConfig,
  createDeckupAstroConfigWithOperations,
  DEFAULT_DEV_PORT,
  resolveRawAstroCodeHighlightOptions,
} from "../src/astro.ts";
import {
  resolveDeckupBuiltInIntegrations,
  writeDeckupBuiltInIntegrationAssets,
} from "../src/built-in-integrations.ts";
import { loadDeckupConfig } from "../src/config.ts";
import { createDeckupCliIntegration } from "../src/integration.ts";
import {
  getNpmThemeCacheEntryDir,
  parseNpmThemeSource,
  resolveCachedNpmThemePackage,
  DECKUP_THEME_CACHE_ENV,
  type NpmThemeInstallOperations,
  type DeckupNpmThemeSource,
  type DeckupNpmThemeResolveOptions,
} from "../src/npm-theme.ts";
import {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  createSingleDeckRegistry,
  normalizePath,
  resolveDeckFile,
} from "@deckup/core";
import { resolveDeckupThemeLayouts } from "../src/theme.ts";
import type { DeckupRuntimePaths, DeckupTailwindOptions } from "../src/types.ts";

/**
 * Test-only bridge to packages/core/src/npm-theme.ts's private lock-timeout /
 * lifecycle-fault seam (`resolveCachedNpmThemePackageForTests`). That seam is
 * intentionally not exported from packages/core/src/index.ts or
 * apps/cli/src/npm-theme.ts, so it cannot be reached with a static import
 * here without leaking into this package's public declarations. A computed
 * dynamic import keeps the source module's own exports (and this file's
 * declaration surface) unchanged; the return value is cast through a local
 * structural type describing only what these tests use.
 */
type NpmThemeCacheLockClockForTests = { now(): number; wait(ms: number): Promise<void> };
type NpmThemeCacheLifecycleOperationsForTests = {
  removeTempEntry(tempEntryDir: string): Promise<void>;
  releaseLock(lockDir: string): Promise<void>;
};
type ResolveCachedNpmThemePackageForTests = (
  source: DeckupNpmThemeSource,
  options: DeckupNpmThemeResolveOptions,
  overrides?: {
    lockClock?: NpmThemeCacheLockClockForTests;
    lifecycle?: NpmThemeCacheLifecycleOperationsForTests;
  },
) => Promise<unknown>;

const coreNpmThemeSourceModuleUrl = new URL(
  "../../../packages/core/src/npm-theme.ts",
  import.meta.url,
);

async function resolveCachedNpmThemePackageForLifecycleFaultTests(
  source: DeckupNpmThemeSource,
  options: DeckupNpmThemeResolveOptions,
  overrides: {
    lockClock?: NpmThemeCacheLockClockForTests;
    lifecycle?: NpmThemeCacheLifecycleOperationsForTests;
  },
) {
  const coreNpmThemeSourceModule = (await import(coreNpmThemeSourceModuleUrl.href)) as {
    resolveCachedNpmThemePackageForTests: ResolveCachedNpmThemePackageForTests;
  };
  return coreNpmThemeSourceModule.resolveCachedNpmThemePackageForTests(source, options, overrides);
}

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

function tailwindTestPaths(projectRoot = resolve("/tmp/deckup-project")): DeckupRuntimePaths {
  return { ...testPaths(projectRoot), runtimeOutDir: join(projectRoot, ".deckup") };
}

function resolveTailwindForTest(
  paths: DeckupRuntimePaths,
  config = {},
  calls: Array<DeckupTailwindOptions | undefined> = [],
) {
  const plugins = [{ name: "tailwind:scan" }, { name: "tailwind:generate" }];
  const resolution = resolveDeckupBuiltInIntegrations(paths, config, {
    createTailwindPlugins(options) {
      calls.push(options);
      return plugins;
    },
    resolveTailwindCss: () => "/deckup/node_modules/tailwindcss/index.css",
  });
  return { calls, plugins, resolution };
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

async function loadCliDeckLayoutSource(
  integration: ReturnType<typeof createDeckupCliIntegration>,
  projectRoot: string,
) {
  let updatedConfig:
    | { vite?: { plugins?: Array<{ name?: string; load?: (id: string) => unknown }> } }
    | undefined;
  const setupHook = (integration.hooks as Record<string, (args: unknown) => Promise<void>>)[
    "astro:config:setup"
  ];
  await setupHook({
    config: { root: pathToFileURL(`${projectRoot}/`) },
    injectRoute() {},
    updateConfig(config: typeof updatedConfig) {
      updatedConfig = config;
    },
  });
  const plugin = updatedConfig?.vite?.plugins?.find(
    (candidate) => candidate.name === "deckup:cli-deck-layout",
  );
  return String(plugin?.load?.("virtual:deckup/cli/deck-layout.astro"));
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

async function writeThemeLayoutPackage(
  projectRoot: string,
  packageName: string,
  metadata: Record<string, unknown> = {},
) {
  const packageDir = join(projectRoot, "node_modules", ...packageName.split("/"));
  const layoutsDir = join(packageDir, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      ...metadata,
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

function lockDirFor(cacheDir: string, source: DeckupNpmThemeSource) {
  const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
  const cacheKey = basename(cacheEntryDir);
  return join(dirname(dirname(cacheEntryDir)), "locks", `${cacheKey}.lock`);
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
  metadata: Record<string, unknown> = {},
) {
  const layoutsDir = join(packageRoot, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
      type: "module",
      ...metadata,
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
        _resolved: `https://registry.example.test/${packageName.replace("/", "-")}-${version}.tgz`,
        _integrity: "sha512-test-integrity",
      };
    },
    async extract(spec, target, options) {
      calls.push(`extract:${spec}:${options.cache}:${options.integrity ?? "none"}`);
      await writeCachedThemePackage(target, packageName, version);
      return { from: spec, resolved: spec, integrity: options.integrity };
    },
  } satisfies NpmThemeInstallOperations;
}

test("resolveCachedNpmThemePackage forwards manifest._resolved and _integrity unchanged to extract", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const extractCalls: Array<{ spec: string; integrity?: string }> = [];

    await resolveCachedNpmThemePackage(source, {
      cacheDir,
      confirmDownload: async () => true,
      operations: {
        async manifest() {
          return {
            name: "@acme/deckup-theme",
            version: "1.2.3",
            _resolved: "https://registry.example.test/acme-deckup-theme-1.2.3.tgz",
            _integrity: "sha512-forwarded-integrity",
          };
        },
        async extract(spec, target, options) {
          extractCalls.push({ spec, integrity: options.integrity });
          await writeCachedThemePackage(target, "@acme/deckup-theme", "1.2.3");
          return { from: spec, resolved: spec, integrity: options.integrity };
        },
      },
    });

    expect(extractCalls).toEqual([
      {
        spec: "https://registry.example.test/acme-deckup-theme-1.2.3.tgz",
        integrity: "sha512-forwarded-integrity",
      },
    ]);
  });
});

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

test("resolveDeckupThemeLayouts resolves installed theme descriptions from the project root", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeThemeLayoutPackage(projectRoot, "@acme/deckup-layout-theme", {
      description: "  Installed fixture theme.  ",
      deckup: {
        layouts: {
          cover: { description: "  Opens the installed fixture deck.  " },
        },
      },
    });

    const theme = await resolveDeckupThemeLayouts(projectRoot, "@acme/deckup-layout-theme", {
      sourceMode: "installed",
    });

    expect(theme.description).toBe("Installed fixture theme.");
    expect(theme.layouts.find((layout) => layout.id === "cover")?.description).toBe(
      "Opens the installed fixture deck.",
    );
    expect(theme.layouts.find((layout) => layout.id === "default")?.description).toBeUndefined();
  });
});

test("resolveDeckupThemeLayouts rejects metadata for an undiscovered installed layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeThemeLayoutPackage(projectRoot, "@acme/deckup-layout-theme", {
      deckup: {
        layouts: {
          missing: { description: "This layout does not exist." },
        },
      },
    });

    await expect(
      resolveDeckupThemeLayouts(projectRoot, "@acme/deckup-layout-theme", {
        sourceMode: "installed",
      }),
    ).rejects.toThrow(
      /Deckup theme "@acme\/deckup-layout-theme".*deckup\.layouts\.missing.*unknown layout "missing"/,
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

test("resolveDeckupThemeLayouts resolves npm theme descriptions from one cached manifest", async () => {
  await withProjectRoot(async (projectRoot) => {
    await withThemeCache(async (cacheDir) => {
      const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
      const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
      await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.2.3", {
        description: "  Cached fixture theme.  ",
        deckup: {
          layouts: {
            default: { description: "  Shows cached theme content.  " },
          },
        },
      });
      await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");

      await withSerializedProcessGlobals(() =>
        withNpmThemeCacheEnv(cacheDir, async () => {
          const theme = await resolveDeckupThemeLayouts(
            projectRoot,
            "npm:@acme/deckup-theme@1.2.3",
          );

          expect(theme.description).toBe("Cached fixture theme.");
          expect(theme.layouts[0]?.description).toBe("Shows cached theme content.");
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

test("resolveCachedNpmThemePackage rejects invalid cache metadata without repairing", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await mkdir(cacheEntryDir, { recursive: true });
    await writeFile(join(cacheEntryDir, "deckup-npm-theme.json"), "{}\n");
    const metadataPath = join(cacheEntryDir, "deckup-npm-theme.json");
    const beforeMetadata = await readFile(metadataPath, "utf8");

    const calls: string[] = [];
    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => {
          calls.push("confirm");
          return true;
        },
        operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls),
      }),
    ).rejects.toThrow(
      `Cached Deckup npm theme metadata does not match ${source.spec}: ${metadataPath}`,
    );

    expect(calls).toEqual([]);
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(beforeMetadata);
    await expect(readdir(cacheEntryDir)).resolves.toEqual(["deckup-npm-theme.json"]);
  });
});

test("resolveCachedNpmThemePackage rejects metadata/package version mismatches without repairing", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.0.0");
    await writeCachedThemeMetadata(cacheEntryDir, source, "2.0.0");
    const packageJsonPath = join(cacheEntryDir, "package", "package.json");
    const beforePackageJson = await readFile(packageJsonPath, "utf8");
    const beforeMetadata = await readFile(join(cacheEntryDir, "deckup-npm-theme.json"), "utf8");

    const calls: string[] = [];
    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => {
          calls.push("confirm");
          return true;
        },
        operations: fakeNpmThemeOperations("@acme/deckup-theme", "2.0.0", calls),
      }),
    ).rejects.toThrow(
      `Cached Deckup npm theme metadata version mismatch for ${source.spec}: expected 2.0.0, got 1.0.0.`,
    );

    expect(calls).toEqual([]);
    await expect(readFile(packageJsonPath, "utf8")).resolves.toBe(beforePackageJson);
    await expect(readFile(join(cacheEntryDir, "deckup-npm-theme.json"), "utf8")).resolves.toBe(
      beforeMetadata,
    );
  });
});

test("resolveCachedNpmThemePackage rejects invalid cached package metadata without repairing", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/other-theme", "1.2.3");
    await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");
    const packageJsonPath = join(cacheEntryDir, "package", "package.json");
    const metadataPath = join(cacheEntryDir, "deckup-npm-theme.json");
    const beforePackageJson = await readFile(packageJsonPath, "utf8");
    const beforeMetadata = await readFile(metadataPath, "utf8");
    const beforeEntries = (await readdir(cacheEntryDir)).sort();

    const calls: string[] = [];
    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => {
          calls.push("confirm");
          return true;
        },
        operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls),
      }),
    ).rejects.toThrow(
      `Cached Deckup npm theme package name mismatch for ${source.spec}: expected @acme/deckup-theme, got @acme/other-theme.`,
    );

    expect(calls).toEqual([]);
    await expect(readFile(packageJsonPath, "utf8")).resolves.toBe(beforePackageJson);
    await expect(readFile(metadataPath, "utf8")).resolves.toBe(beforeMetadata);
    await expect(readdir(cacheEntryDir)).resolves.toEqual(beforeEntries);
  });
});

test("resolveCachedNpmThemePackage rejects invalid descriptions without repairing the cache", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.2.3", {
      description: 42,
    });
    await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");
    const packageJsonPath = join(cacheEntryDir, "package", "package.json");
    const beforePackageJson = await readFile(packageJsonPath, "utf8");
    const beforeMetadata = await readFile(join(cacheEntryDir, "deckup-npm-theme.json"), "utf8");
    const calls: string[] = [];

    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => {
          calls.push("confirm");
          return true;
        },
        operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls),
      }),
    ).rejects.toThrow(
      /Cached Deckup npm theme package metadata field "description" must be a non-empty string/,
    );

    expect(calls).toEqual([]);
    await expect(readFile(packageJsonPath, "utf8")).resolves.toBe(beforePackageJson);
    await expect(readFile(join(cacheEntryDir, "deckup-npm-theme.json"), "utf8")).resolves.toBe(
      beforeMetadata,
    );
  });
});

test("resolveCachedNpmThemePackage keeps parsed package JSON source-private", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await writeCachedThemePackage(join(cacheEntryDir, "package"), "@acme/deckup-theme", "1.2.3");
    await writeCachedThemeMetadata(cacheEntryDir, source, "1.2.3");

    const cachedTheme = await resolveCachedNpmThemePackage(source, { cacheDir });

    expect(cachedTheme).not.toHaveProperty("packageJson");
  });
});

test("resolveCachedNpmThemePackage serializes same-cache-key downloads", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;

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
    expect(second.packageRoot).toBe(
      await realpath(join(getNpmThemeCacheEntryDir(cacheDir, source), "package")),
    );
    await expect(readdir(join(cacheDir, "locks"))).resolves.toEqual([]);
  });
});

test("resolveCachedNpmThemePackage times out lock acquisition on a monotonic clock, ignores wall-clock rollback, and never deletes the lock", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const lockDir = lockDirFor(cacheDir, source);
    // Pre-create an old/abandoned lock; this used to be deleted via mtime-based
    // staleness. It must now cause the waiter to time out instead.
    await mkdir(dirname(lockDir), { recursive: true });
    await mkdir(lockDir);

    let monotonicNow = 0;
    const waitDurations: number[] = [];
    const lockClock: NpmThemeCacheLockClockForTests = {
      now: () => monotonicNow,
      wait: async (ms) => {
        waitDurations.push(ms);
        monotonicNow += ms;
      },
    };

    const originalDateNow = Date.now;
    Date.now = () => {
      // Wall-clock rollback during the wait must not affect the monotonic
      // deadline computed from lockClock.now().
      return -1_000_000;
    };

    let receivedError: unknown;
    try {
      await resolveCachedNpmThemePackageForLifecycleFaultTests(
        source,
        {
          cacheDir,
          confirmDownload: async () => {
            throw new Error("must not confirm while the lock is held");
          },
          operations: {
            async manifest() {
              throw new Error("must not fetch a manifest while the lock is held");
            },
            async extract() {
              throw new Error("must not extract while the lock is held");
            },
          },
        },
        {
          lockClock,
          lifecycle: {
            removeTempEntry: async () => {
              throw new Error("must not run temp cleanup: lock was never acquired");
            },
            releaseLock: async () => {
              throw new Error("must not release a lock this waiter never acquired");
            },
          },
        },
      );
    } catch (error) {
      receivedError = error;
    } finally {
      Date.now = originalDateNow;
    }

    expect(receivedError).toBeInstanceOf(Error);
    expect((receivedError as Error).name).toBe("NpmThemeCacheLockTimeoutError");
    expect((receivedError as Error).message).toContain(source.spec);
    expect((receivedError as Error).message).toContain("60000");
    expect((receivedError as Error).message).toContain(lockDir);
    expect((receivedError as Error).message).toContain(
      "Remove this lock only after confirming no Deckup process is using it",
    );
    expect(waitDurations.length).toBeGreaterThan(0);
    await expect(stat(lockDir)).resolves.toBeDefined();
  });
});

test("resolveCachedNpmThemePackage fails a rename collision and preserves the external entry", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    const calls: string[] = [];

    const operations = fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3", calls);
    let tempEntryDirAtFailure: string | undefined;
    await expect(
      resolveCachedNpmThemePackage(source, {
        cacheDir,
        confirmDownload: async () => true,
        operations: {
          ...operations,
          async extract(spec, target, options) {
            const result = await operations.extract(spec, target, options);
            tempEntryDirAtFailure = dirname(target);
            // Simulate an out-of-band writer that already created the cache
            // entry (for example, another host or a manual repair) before
            // promotion runs.
            await writeCachedThemePackage(
              join(cacheEntryDir, "package"),
              "@acme/other-theme",
              "9.9.9",
            );
            await writeCachedThemeMetadata(cacheEntryDir, source, "9.9.9");
            return result;
          },
        },
      }),
    ).rejects.toThrow(/ENOTEMPTY|EEXIST/);

    const externalPackageJson = await readFile(
      join(cacheEntryDir, "package", "package.json"),
      "utf8",
    );
    expect(JSON.parse(externalPackageJson)).toMatchObject({
      name: "@acme/other-theme",
      version: "9.9.9",
    });
    expect(tempEntryDirAtFailure).toBeDefined();
    await expect(stat(tempEntryDirAtFailure!)).rejects.toThrow();
  });
});

test("resolveCachedNpmThemePackage reports an ordered AggregateError when a primary failure and temp cleanup both fail", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const cleanupError = new Error("temp cleanup failed");

    let receivedError: unknown;
    try {
      await resolveCachedNpmThemePackageForLifecycleFaultTests(
        source,
        {
          cacheDir,
          confirmDownload: async () => true,
          operations: {
            async manifest() {
              return {
                name: "@acme/deckup-theme",
                version: "1.2.3",
                _resolved: "https://registry.example.test/acme-deckup-theme-1.2.3.tgz",
              };
            },
            async extract() {
              throw new Error("extract failed");
            },
          },
        },
        {
          lifecycle: {
            removeTempEntry: async () => {
              throw cleanupError;
            },
            releaseLock: async (lockDir) => {
              await rm(lockDir, { force: true, recursive: true });
            },
          },
        },
      );
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(AggregateError);
    expect((receivedError as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "extract failed" }),
      cleanupError,
    ]);
  });
});

test("resolveCachedNpmThemePackage reports an ordered AggregateError when a primary failure and lock release both fail", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const releaseError = new Error("lock release failed");

    let receivedError: unknown;
    try {
      await resolveCachedNpmThemePackageForLifecycleFaultTests(
        source,
        {
          cacheDir,
          confirmDownload: async () => true,
          operations: {
            async manifest() {
              return {
                name: "@acme/deckup-theme",
                version: "1.2.3",
                _resolved: "https://registry.example.test/acme-deckup-theme-1.2.3.tgz",
              };
            },
            async extract() {
              throw new Error("extract failed");
            },
          },
        },
        {
          lifecycle: {
            removeTempEntry: async (tempEntryDir) => {
              await rm(tempEntryDir, { force: true, recursive: true });
            },
            releaseLock: async () => {
              throw releaseError;
            },
          },
        },
      );
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(AggregateError);
    expect((receivedError as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "extract failed" }),
      releaseError,
    ]);
  });
});

test("resolveCachedNpmThemePackage rejects when successful work is followed by a lock release failure", async () => {
  await withThemeCache(async (cacheDir) => {
    const source = parseNpmThemeSource("npm:@acme/deckup-theme@1.2.3")!;
    const releaseError = new Error("lock release failed");

    await expect(
      resolveCachedNpmThemePackageForLifecycleFaultTests(
        source,
        {
          cacheDir,
          confirmDownload: async () => true,
          operations: fakeNpmThemeOperations("@acme/deckup-theme", "1.2.3"),
        },
        {
          lifecycle: {
            removeTempEntry: async (tempEntryDir) => {
              await rm(tempEntryDir, { force: true, recursive: true });
            },
            releaseLock: async () => {
              throw releaseError;
            },
          },
        },
      ),
    ).rejects.toBe(releaseError);

    const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);
    await expect(readFile(join(cacheEntryDir, "deckup-npm-theme.json"), "utf8")).resolves.toContain(
      "1.2.3",
    );
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

test("createDeckupCliIntegration fails fast when a required Core runtime specifier cannot resolve", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    const resolvedProjectRoot = await realpath(projectRoot);
    const deck = await resolveDeckFile(resolvedProjectRoot, "slides/deck.astro");
    const registry = createSingleDeckRegistry(resolvedProjectRoot, deck);
    const resolveError = new Error("Cannot find module '@deckup/core/runtime/styles/global.css'");

    let thrown: unknown;
    try {
      createDeckupCliIntegration({
        registry,
        resolveCoreRuntimeSpecifier: (specifier: string) => {
          if (specifier === "@deckup/core/runtime/styles/global.css") {
            throw resolveError;
          }
          return specifier;
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      'Deckup CLI could not resolve required Core runtime asset "@deckup/core/runtime/styles/global.css"',
    );
    expect((thrown as Error).cause).toBe(resolveError);
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

test("CLI integration Vite fs allow includes the Core runtime directory", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    const resolvedProjectRoot = await realpath(projectRoot);
    const deck = await resolveDeckFile(resolvedProjectRoot, "slides/deck.astro");
    const registry = createSingleDeckRegistry(resolvedProjectRoot, deck);
    const integration = createDeckupCliIntegration({ registry });
    let updatedConfig: { vite?: { server?: { fs?: { allow?: string[] } } } } | undefined;
    const setupHook = (integration.hooks as Record<string, (args: unknown) => Promise<void>>)[
      "astro:config:setup"
    ];

    await setupHook({
      config: {
        root: pathToFileURL(`${resolvedProjectRoot}/`),
      },
      injectRoute() {},
      updateConfig(config: typeof updatedConfig) {
        updatedConfig = config;
      },
    });

    const coreRuntimeDir = normalizePath(
      join(dirname(configTestRequire.resolve("@deckup/core/package.json")), "runtime"),
    );
    expect(updatedConfig?.vite?.server?.fs?.allow).toEqual(
      expect.arrayContaining([coreRuntimeDir]),
    );
  });
});

test("CLI integration resolves navigation to its TypeScript file for Vite transformation", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    const resolvedProjectRoot = await realpath(projectRoot);
    const deck = await resolveDeckFile(resolvedProjectRoot, "slides/deck.astro");
    const registry = createSingleDeckRegistry(resolvedProjectRoot, deck);
    const integration = createDeckupCliIntegration({ registry });
    let updatedConfig:
      | { vite?: { plugins?: Array<{ name?: string; resolveId?: (id: string) => unknown }> } }
      | undefined;
    const setupHook = (integration.hooks as Record<string, (args: unknown) => Promise<void>>)[
      "astro:config:setup"
    ];

    await setupHook({
      config: {
        root: pathToFileURL(`${resolvedProjectRoot}/`),
      },
      injectRoute() {},
      updateConfig(config: typeof updatedConfig) {
        updatedConfig = config;
      },
    });

    const plugin = updatedConfig?.vite?.plugins?.find(
      (candidate) => candidate.name === "deckup:cli-deck-layout",
    );
    const navigationFilePath = normalizePath(
      configTestRequire.resolve("@deckup/core/runtime/scripts/navigation.ts"),
    );

    expect(plugin?.resolveId?.("virtual:deckup/cli/navigation.ts")).toBe(navigationFilePath);
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

test("built-in Tailwind resolver enables default plugins and a project-root CSS source", () => {
  const paths = tailwindTestPaths();
  const { calls, plugins, resolution } = resolveTailwindForTest(paths);
  expect(calls).toEqual([undefined]);
  expect(resolution.vitePlugins).toEqual([plugins]);
  expect(resolution.requiredAliases).toEqual([
    { find: /^tailwindcss$/, replacement: "/deckup/node_modules/tailwindcss/index.css" },
  ]);
  expect(resolution.assets).toEqual([
    {
      filePath: join(paths.runtimeOutDir, "tailwind.css"),
      moduleId: `/@fs/${normalizePath(join(paths.runtimeOutDir, "tailwind.css"))}`,
      source: '@import "tailwindcss" source("..");\n',
    },
  ]);
  expect(resolution.runtimeCssModuleIds).toEqual([resolution.assets[0].moduleId]);
});

test("built-in Tailwind resolver forwards empty options without adding defaults", () => {
  const options = {} satisfies DeckupTailwindOptions;
  const { calls } = resolveTailwindForTest(tailwindTestPaths(), {
    integrations: { tailwind: options },
  });
  expect(calls).toEqual([options]);
  expect(calls[0]).toBe(options);
});

test("built-in Tailwind resolver forwards configured options without adding defaults", () => {
  const options = { optimize: { minify: false } } satisfies DeckupTailwindOptions;
  const { calls } = resolveTailwindForTest(tailwindTestPaths(), {
    integrations: { tailwind: options },
  });
  expect(calls).toEqual([options]);
  expect(calls[0]).toBe(options);
});

test("built-in Tailwind resolver disables every contribution for strict false", () => {
  const resolution = resolveDeckupBuiltInIntegrations(
    tailwindTestPaths(),
    { integrations: { tailwind: false } },
    {
      createTailwindPlugins() {
        throw new Error("disabled Tailwind must not create plugins");
      },
      resolveTailwindCss() {
        throw new Error("disabled Tailwind must not resolve CSS");
      },
    },
  );
  expect(resolution).toEqual({
    vitePlugins: [],
    requiredAliases: [],
    runtimeCssModuleIds: [],
    assets: [],
  });
});

test("built-in Tailwind resolver fails fast and retains CSS resolution cause", () => {
  const cause = new Error("injected Tailwind CSS resolution failure");
  let caught: unknown;

  try {
    resolveDeckupBuiltInIntegrations(
      tailwindTestPaths(),
      {},
      {
        createTailwindPlugins: () => [],
        resolveTailwindCss() {
          throw cause;
        },
      },
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(
    'Deckup CLI could not resolve required Tailwind CSS asset "tailwindcss/index.css".',
  );
  expect((caught as Error).cause).toBe(cause);
});

test("built-in integration assets are written beneath the Deckup work directory", async () => {
  await withProjectRoot(async (projectRoot) => {
    const paths = tailwindTestPaths(projectRoot);
    const { resolution } = resolveTailwindForTest(paths);
    await writeDeckupBuiltInIntegrationAssets(resolution);
    await expect(readFile(join(paths.runtimeOutDir, "tailwind.css"), "utf8")).resolves.toBe(
      '@import "tailwindcss" source("..");\n',
    );
  });
});

test("no config installs built-in Tailwind plugins, CSS entry, and layout import", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    const { astroConfig, paths } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });
    expect(Array.isArray(astroConfig.vite?.plugins?.[0])).toBe(true);
    expect(astroConfig.vite?.resolve?.alias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replacement: expect.stringMatching(/tailwindcss\/index\.css$/) }),
      ]),
    );
    const tailwindCssPath = join(paths.runtimeOutDir, "tailwind.css");
    await expect(readFile(tailwindCssPath, "utf8")).resolves.toBe(
      '@import "tailwindcss" source("..");\n',
    );
    const cliIntegration = (astroConfig.integrations as Array<{ name?: string }>).find(
      (integration) => integration.name === "deckup:cli",
    ) as ReturnType<typeof createDeckupCliIntegration>;
    const layoutSource = await loadCliDeckLayoutSource(cliIntegration, paths.projectRoot);
    expect(layoutSource).toContain(`/@fs/${normalizePath(tailwindCssPath)}`);
  });
});

test("configured Tailwind options reach the factory exactly once by reference", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { integrations: { tailwind: { optimize: { minify: false } } } };\n",
    );
    const factoryCalls: Array<DeckupTailwindOptions | undefined> = [];
    let resolutionCalls = 0;
    const result = await createDeckupAstroConfigWithOperations(
      { root: projectRoot, deckFile: "slides/deck.astro" },
      {
        resolveBuiltInIntegrations(paths, config) {
          resolutionCalls += 1;
          return resolveDeckupBuiltInIntegrations(paths, config, {
            createTailwindPlugins(options) {
              factoryCalls.push(options);
              return [{ name: "tailwind:test" }];
            },
            resolveTailwindCss: () => "/deckup/node_modules/tailwindcss/index.css",
          });
        },
        writeBuiltInIntegrationAssets: writeDeckupBuiltInIntegrationAssets,
      },
    );
    const loadedOptions = result.deckupConfig?.integrations?.tailwind;
    expect(resolutionCalls).toBe(1);
    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]).toBe(loadedOptions);
    expect(loadedOptions).toEqual({ optimize: { minify: false } });
    expect(result.astroConfig.vite?.plugins).toEqual([[{ name: "tailwind:test" }]]);
  });
});

test("integrations.tailwind false removes plugins, alias, generated CSS, and layout import", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { integrations: { tailwind: false } };\n",
    );
    const { astroConfig, paths } = await createDeckupAstroConfig({
      root: projectRoot,
      deckFile: "slides/deck.astro",
    });
    expect(astroConfig.vite?.plugins).toEqual([]);
    const aliases = (astroConfig.vite?.resolve?.alias ?? []) as unknown as Array<{
      find?: RegExp;
    }>;
    expect(aliases.some((alias) => alias.find?.test("tailwindcss"))).toBe(false);
    await expect(stat(join(paths.runtimeOutDir, "tailwind.css"))).rejects.toThrow();
    const cliIntegration = (astroConfig.integrations as Array<{ name?: string }>).find(
      (integration) => integration.name === "deckup:cli",
    ) as ReturnType<typeof createDeckupCliIntegration>;
    expect(await loadCliDeckLayoutSource(cliIntegration, paths.projectRoot)).not.toContain(
      "tailwind.css",
    );
  });
});

test("built-in Tailwind plugins stay before an undeduplicated user Tailwind group", () => {
  const paths = tailwindTestPaths();
  const { plugins: builtInPlugins, resolution } = resolveTailwindForTest(paths);
  const config = createAstroInlineConfigWithBuiltIns(
    paths,
    {},
    { astro: { vite: { plugins: [builtInPlugins as never] } } },
    undefined,
    undefined,
    resolution,
  );
  expect(config.vite?.plugins).toEqual([builtInPlugins, builtInPlugins]);
  expect(config.vite?.plugins?.[0]).toBe(config.vite?.plugins?.[1]);
});

test("CLI integration imports additional CSS modules after Core CSS", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeAstroDeck(projectRoot);
    const resolvedProjectRoot = await realpath(projectRoot);
    const deck = await resolveDeckFile(resolvedProjectRoot, "slides/deck.astro");
    const registry = createSingleDeckRegistry(resolvedProjectRoot, deck);
    const tailwindCssModuleId = `/@fs/${normalizePath(
      join(resolvedProjectRoot, ".deckup/tailwind.css"),
    )}`;
    const integration = createDeckupCliIntegration({
      registry,
      additionalCssModuleIds: [tailwindCssModuleId],
    });
    const source = await loadCliDeckLayoutSource(integration, resolvedProjectRoot);
    expect(source.indexOf("runtime/styles/global.css")).toBeLessThan(
      source.indexOf(tailwindCssModuleId),
    );
  });
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
    const generatedPageSource = await readFile(paths.generatedPageFilePath!, "utf8");
    expect(generatedPageSource).toContain(VIRTUAL_DECKUP_THEME_LAYOUTS_ID);
    expect(generatedPageSource).toContain('<slot name="left" slot="left" />');
    expect(generatedPageSource).toContain('theme = "@acme/deckup-layout-theme"');
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
  const { plugins: builtInPlugins, resolution: builtInIntegrations } =
    resolveTailwindForTest(paths);
  const config = createAstroInlineConfigWithBuiltIns(
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
    builtInIntegrations,
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
  expect(config.vite?.plugins).toEqual([builtInPlugins, userPlugin]);
  expect(config.vite?.resolve?.alias).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ find: /^astro$/ }),
      expect.objectContaining({ find: /^tailwindcss$/ }),
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
