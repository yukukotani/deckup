import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { build, dev, type AstroInlineConfig } from "astro";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { prepareRuntime } from "./runtime.ts";
import type {
  SlidaBuildOptions,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaResolvedConfig,
  SlidaRuntimePaths,
} from "./types.ts";

export const DEFAULT_DEV_HOST = "127.0.0.1";
export const DEFAULT_DEV_PORT = 4321;
export const DEFAULT_BUILD_OUT_DIR = "dist";

const require = createRequire(import.meta.url);
const astroPackageRoot = dirname(require.resolve("astro/package.json"));

export function normalizeBuildOutDir(projectRoot: string, outDir = DEFAULT_BUILD_OUT_DIR) {
  return resolve(projectRoot, outDir);
}

export function createAstroInlineConfig(
  paths: SlidaRuntimePaths,
  options: SlidaDevOptions | SlidaBuildOptions = {},
): AstroInlineConfig {
  const devOptions = options as SlidaDevOptions;
  const buildOptions = options as SlidaBuildOptions;

  const astroConfig = {
    root: paths.projectRoot,
    srcDir: paths.runtimeOutDir,
    outDir: normalizeBuildOutDir(paths.projectRoot, buildOptions.outDir),
    configFile: false,
    devToolbar: { enabled: false },
    output: "static",
    logLevel: options.logLevel ?? "info",
    integrations: [mdx()],
    server: {
      host: devOptions.host ?? DEFAULT_DEV_HOST,
      port: devOptions.port ?? DEFAULT_DEV_PORT,
      open: devOptions.open ?? false,
    },
    vite: {
      plugins: [tailwindcss() as never],
      optimizeDeps: {
        exclude: ["aria-query", "axobject-query", "html-escaper"],
      },
      resolve: {
        alias: [
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
          {
            find: /^astro\/jsx-runtime$/,
            replacement: `${astroPackageRoot}/dist/jsx-runtime/index.js`,
          },
          { find: /^astro\/runtime\/(.+)$/, replacement: `${astroPackageRoot}/dist/runtime/$1` },
          { find: /^astro$/, replacement: `${astroPackageRoot}/dist/index.js` },
        ],
      },
      server: {
        fs: {
          allow: [paths.projectRoot, paths.runtimeOutDir, paths.runtimeSourceDir],
        },
      },
    },
  } as AstroInlineConfig;

  return astroConfig;
}

export async function createSlidaAstroConfig(
  options: SlidaDevOptions | SlidaBuildOptions = {},
): Promise<SlidaResolvedConfig> {
  const paths = await prepareRuntime(options.root);
  return { paths, astroConfig: createAstroInlineConfig(paths, options) };
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
