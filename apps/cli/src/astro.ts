import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { build, dev, type AstroInlineConfig } from "astro";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { loadSlidaConfig, resolveSlidaConfig } from "./config.ts";
import { resolveDeckFile } from "./deck.ts";
import { prepareRuntime, resolveProjectRoot } from "./runtime.ts";
import { remarkSlidaMdxPages } from "./slida-mdx-pages.ts";
import { createSlidaVitePlugins } from "./slida-vite-plugins.ts";
import type {
  SlidaBuildOptions,
  SlidaConfig,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaResolvedConfig,
  SlidaResolvedDeck,
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
): AstroInlineConfig {
  const devOptions = options as SlidaDevOptions;
  const buildOptions = options as SlidaBuildOptions;
  const userAstroConfig = slidaConfig.astro ?? {};
  const userViteConfig = { ...userAstroConfig.vite };
  delete (userViteConfig as { root?: unknown }).root;
  const userViteServer = userViteConfig.server ?? {};
  const userViteFs = userViteServer.fs ?? {};
  const slidaVitePlugins = deck ? createSlidaVitePlugins(deck) : [];
  const requiredAliases = [
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
  const paths = await prepareRuntime(projectRoot);
  const loadedConfig = await loadSlidaConfig(paths.projectRoot);
  const slidaConfig = resolveSlidaConfig(loadedConfig.config, options);
  return {
    paths,
    deck,
    slidaConfig,
    slidaConfigFile: loadedConfig.filePath,
    astroConfig: createAstroInlineConfig(paths, options, slidaConfig, deck),
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
