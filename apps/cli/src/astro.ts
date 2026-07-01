import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { build, dev, type AstroInlineConfig } from "astro";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { loadSlidaConfig, resolveSlidaConfig } from "./config.ts";
import { resolveDeckFile } from "./deck.ts";
import { prepareRuntime, resolveProjectRoot } from "./runtime.ts";
import { remarkSlidaMdxPages } from "./slida-mdx-pages.ts";
import { createSlidaVitePlugins } from "./slida-vite-plugins.ts";
import {
  VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
} from "./theme-layouts.ts";
import { resolveSlidaThemeLayouts } from "./theme.ts";
import type {
  SlidaBuildOptions,
  SlidaConfig,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaResolvedConfig,
  SlidaResolvedDeck,
  SlidaResolvedTheme,
  SlidaRuntimePaths,
} from "./types.ts";

export const DEFAULT_DEV_HOST = "127.0.0.1";
export const DEFAULT_DEV_PORT = 4321;
export const DEFAULT_BUILD_OUT_DIR = "dist";

const require = createRequire(import.meta.url);
const astroPackageRoot = dirname(require.resolve("astro/package.json"));
const requiredOptimizeDepsExclude = ["aria-query", "axobject-query", "html-escaper"];

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function normalizeAliasEntries(alias: unknown) {
  if (alias === undefined) {
    return [];
  }
  if (Array.isArray(alias)) {
    return alias;
  }
  if (typeof alias === "object" && alias !== null) {
    return Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));
  }
  return [];
}

export function normalizeBuildOutDir(projectRoot: string, outDir = DEFAULT_BUILD_OUT_DIR) {
  return resolve(projectRoot, outDir);
}

async function resolveRuntimeSlidaTheme(projectRoot: string, theme: unknown) {
  return resolveSlidaThemeLayouts(projectRoot, theme);
}

async function writeGeneratedPageComponent(
  paths: SlidaRuntimePaths,
  slidaTheme: SlidaResolvedTheme,
): Promise<SlidaRuntimePaths> {
  if (!slidaTheme.layouts?.length) return paths;
  const generatedPageFilePath = join(paths.runtimeOutDir, "generated", "Page.astro");
  await mkdir(dirname(generatedPageFilePath), { recursive: true });
  await writeFile(
    generatedPageFilePath,
    createGeneratedPageComponentSource(slidaTheme.slotNames ?? [], VIRTUAL_SLIDA_THEME_LAYOUTS_ID),
  );
  return { ...paths, generatedPageFilePath };
}

function assertLayoutThemeConfig(paths: SlidaRuntimePaths, slidaTheme?: SlidaResolvedTheme) {
  if (!slidaTheme) return;
  if (!slidaTheme.layouts?.length) {
    throw new Error(
      `Slida theme ${JSON.stringify(slidaTheme.name)} must resolve from layouts/*.astro. Use resolveSlidaThemeLayouts() or createSlidaAstroConfig() instead of a CSS-only theme object.`,
    );
  }
  if (!paths.generatedPageFilePath) {
    throw new Error(
      `Layout Slida theme ${JSON.stringify(slidaTheme.name)} requires a generated Page component. Use createSlidaAstroConfig() or pass paths.generatedPageFilePath when calling createAstroInlineConfig().`,
    );
  }
}

function createMdxIntegration(deck?: SlidaResolvedDeck) {
  if (!deck) {
    return mdx();
  }

  return mdx({
    processor: unified({
      remarkPlugins: [[remarkSlidaMdxPages, { deckFile: deck.filePath }] as never],
    }),
  });
}

export function createAstroInlineConfig(
  paths: SlidaRuntimePaths,
  options: SlidaDevOptions | SlidaBuildOptions = {},
  slidaConfig: SlidaConfig = {},
  deck?: SlidaResolvedDeck,
  slidaTheme?: SlidaResolvedTheme,
): AstroInlineConfig {
  const devOptions = options as SlidaDevOptions;
  const buildOptions = options as SlidaBuildOptions;
  const userAstroConfig = slidaConfig.astro ?? {};
  const userViteConfig = { ...userAstroConfig.vite };
  delete (userViteConfig as { root?: unknown }).root;
  const userViteServer = userViteConfig.server ?? {};
  const userViteFs = userViteServer.fs ?? {};
  assertLayoutThemeConfig(paths, slidaTheme);
  const slidaVitePlugins = deck
    ? createSlidaVitePlugins(deck, slidaTheme, {
        generatedPageFilePath: paths.generatedPageFilePath,
      })
    : [];
  const slidaPageAlias =
    slidaTheme?.layouts?.length && paths.generatedPageFilePath
      ? [{ find: /^@slida\/cli\/page$/, replacement: paths.generatedPageFilePath }]
      : [];
  const requiredAliases = [
    ...slidaPageAlias,
    {
      find: /^astro\/app$/,
      replacement: `${astroPackageRoot}/dist/core/app/entrypoints/index.js`,
    },
    {
      find: /^astro\/compiler-runtime$/,
      replacement: `${astroPackageRoot}/dist/runtime/compiler/index.js`,
    },
    {
      find: /^astro\/entrypoints\/(.+)$/,
      replacement: `${astroPackageRoot}/dist/entrypoints/$1.js`,
    },
    {
      find: /^astro\/errors$/,
      replacement: `${astroPackageRoot}/dist/core/errors/userError.js`,
    },
    { find: /^astro\/jsx-runtime$/, replacement: `${astroPackageRoot}/dist/jsx-runtime/index.js` },
    { find: /^astro\/runtime\/(.+)$/, replacement: `${astroPackageRoot}/dist/runtime/$1` },
    { find: /^astro$/, replacement: `${astroPackageRoot}/dist/index.js` },
  ];
  const requiredFsAllow = [
    paths.projectRoot,
    paths.runtimeOutDir,
    paths.runtimeSourceDir,
    ...(deck ? [dirname(deck.filePath)] : []),
    ...(slidaTheme?.filePath ? [dirname(slidaTheme.filePath)] : []),
    ...(slidaTheme?.layoutsDir ? [slidaTheme.layoutsDir] : []),
  ];

  const astroConfig = {
    ...userAstroConfig,
    root: paths.projectRoot,
    srcDir: paths.runtimeOutDir,
    outDir: normalizeBuildOutDir(paths.projectRoot, buildOptions.outDir),
    configFile: false,
    devToolbar: { enabled: false },
    output: "static",
    logLevel: options.logLevel ?? "info",
    integrations: [createMdxIntegration(deck), ...toArray(userAstroConfig.integrations as never)],
    server: {
      host: devOptions.host ?? DEFAULT_DEV_HOST,
      port: devOptions.port ?? slidaConfig.port ?? DEFAULT_DEV_PORT,
      open: devOptions.open ?? false,
    },
    vite: {
      ...userViteConfig,
      plugins: [...slidaVitePlugins, ...toArray(userViteConfig.plugins as never)],
      optimizeDeps: {
        ...userViteConfig.optimizeDeps,
        exclude: uniqueStrings([
          ...requiredOptimizeDepsExclude,
          ...toArray(userViteConfig.optimizeDeps?.exclude),
        ]),
      },
      resolve: {
        ...userViteConfig.resolve,
        alias: [...requiredAliases, ...normalizeAliasEntries(userViteConfig.resolve?.alias)],
      },
      server: {
        ...userViteServer,
        fs: {
          ...userViteFs,
          allow: uniqueStrings([...requiredFsAllow, ...toArray(userViteFs.allow)]),
          strict: true,
        },
      },
    },
  } as AstroInlineConfig;

  return astroConfig;
}

export async function createSlidaAstroConfig(
  options: SlidaDevOptions | SlidaBuildOptions = {},
): Promise<SlidaResolvedConfig> {
  const projectRoot = await realpath(resolveProjectRoot(options.root));
  const deck = await resolveDeckFile(projectRoot, options.deckFile);
  const preparedPaths = await prepareRuntime(projectRoot);
  const loadedConfig = await loadSlidaConfig(preparedPaths.projectRoot);
  const slidaConfig = resolveSlidaConfig(loadedConfig.config, options);
  const slidaTheme = await resolveRuntimeSlidaTheme(preparedPaths.projectRoot, slidaConfig.theme);
  const paths = await writeGeneratedPageComponent(preparedPaths, slidaTheme);
  return {
    paths,
    deck,
    slidaConfig,
    slidaConfigFile: loadedConfig.filePath,
    slidaTheme,
    astroConfig: createAstroInlineConfig(paths, options, slidaConfig, deck, slidaTheme),
  };
}

export async function startDevServer(options: SlidaDevOptions = {}): Promise<SlidaDevResult> {
  const { astroConfig } = await createSlidaAstroConfig(options);
  const server = await dev(astroConfig);

  return { server, address: server.address };
}

export async function buildDeck(options: SlidaBuildOptions = {}) {
  const { astroConfig } = await createSlidaAstroConfig(options);
  await build(astroConfig);
}
