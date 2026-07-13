import tailwindcss from "@tailwindcss/vite";
import { normalizePath, type DeckupRuntimePaths } from "@deckup/core";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import type { Alias, Plugin, PluginOption } from "vite";

import type {
  DeckupBuiltInIntegrationsConfig,
  DeckupConfig,
  DeckupTailwindOptions,
} from "./types.ts";

export interface DeckupBuiltInIntegrationAsset {
  filePath: string;
  moduleId: string;
  source: string;
}

export interface DeckupResolvedBuiltInIntegrations {
  vitePlugins: PluginOption[];
  requiredAliases: Alias[];
  runtimeCssModuleIds: string[];
  assets: DeckupBuiltInIntegrationAsset[];
}

export type TailwindPluginFactory = (options?: DeckupTailwindOptions) => Plugin[];
export type TailwindCssResolver = () => string;

export interface ResolveDeckupBuiltInIntegrationsOptions {
  createTailwindPlugins?: TailwindPluginFactory;
  resolveTailwindCss?: TailwindCssResolver;
}

type PartialBuiltInIntegrationResolution = Pick<
  DeckupResolvedBuiltInIntegrations,
  "vitePlugins" | "requiredAliases" | "assets"
>;

type BuiltInIntegrationResolverContext = {
  paths: DeckupRuntimePaths;
  createTailwindPlugins: TailwindPluginFactory;
  resolveTailwindCss: TailwindCssResolver;
};

type BuiltInIntegrationResolver<Value> = (
  value: Value,
  context: BuiltInIntegrationResolverContext,
) => PartialBuiltInIntegrationResolution | undefined;

type RegisteredBuiltInIntegrationResolver = {
  key: keyof DeckupBuiltInIntegrationsConfig;
  resolve(
    value: unknown,
    context: BuiltInIntegrationResolverContext,
  ): PartialBuiltInIntegrationResolution | undefined;
};

const require = createRequire(import.meta.url);

function defaultResolveTailwindCss() {
  return require.resolve("tailwindcss/index.css");
}

function resolveRequiredTailwindCss(resolveTailwindCss: TailwindCssResolver) {
  try {
    return resolveTailwindCss();
  } catch (error) {
    throw new Error(
      'Deckup CLI could not resolve required Tailwind CSS asset "tailwindcss/index.css".',
      { cause: error },
    );
  }
}

function registerBuiltInIntegrationResolver<Key extends keyof DeckupBuiltInIntegrationsConfig>(
  key: Key,
  resolve: BuiltInIntegrationResolver<DeckupBuiltInIntegrationsConfig[Key]>,
): RegisteredBuiltInIntegrationResolver {
  return {
    key,
    resolve(value, context) {
      return resolve(value as DeckupBuiltInIntegrationsConfig[Key], context);
    },
  };
}

function resolveTailwindIntegration(
  value: DeckupBuiltInIntegrationsConfig["tailwind"],
  context: BuiltInIntegrationResolverContext,
): PartialBuiltInIntegrationResolution | undefined {
  if (value === false) return undefined;

  const cssFilePath = join(context.paths.runtimeOutDir, "tailwind.css");
  const sourceBase =
    normalizePath(relative(dirname(cssFilePath), context.paths.projectRoot)) || ".";
  const tailwindCssFilePath = normalizePath(resolveRequiredTailwindCss(context.resolveTailwindCss));

  return {
    vitePlugins: [context.createTailwindPlugins(value)],
    requiredAliases: [{ find: /^tailwindcss$/, replacement: tailwindCssFilePath }],
    assets: [
      {
        filePath: cssFilePath,
        moduleId: `/@fs/${normalizePath(cssFilePath)}`,
        source: `@import "tailwindcss" source(${JSON.stringify(sourceBase)});\n`,
      },
    ],
  };
}

const builtInIntegrationResolvers = [
  registerBuiltInIntegrationResolver("tailwind", resolveTailwindIntegration),
] as const;

export function resolveDeckupBuiltInIntegrations(
  paths: DeckupRuntimePaths,
  config: DeckupConfig = {},
  options: ResolveDeckupBuiltInIntegrationsOptions = {},
): DeckupResolvedBuiltInIntegrations {
  const context: BuiltInIntegrationResolverContext = {
    paths,
    createTailwindPlugins: options.createTailwindPlugins ?? tailwindcss,
    resolveTailwindCss: options.resolveTailwindCss ?? defaultResolveTailwindCss,
  };
  const resolutions = builtInIntegrationResolvers.flatMap((resolver) => {
    const resolution = resolver.resolve(config.integrations?.[resolver.key], context);
    return resolution ? [resolution] : [];
  });
  const assets = resolutions.flatMap((resolution) => resolution.assets);

  return {
    vitePlugins: resolutions.flatMap((resolution) => resolution.vitePlugins),
    requiredAliases: resolutions.flatMap((resolution) => resolution.requiredAliases),
    runtimeCssModuleIds: assets.map((asset) => asset.moduleId),
    assets,
  };
}

export async function writeDeckupBuiltInIntegrationAssets(
  resolution: DeckupResolvedBuiltInIntegrations,
) {
  await Promise.all(
    resolution.assets.map(async (asset) => {
      await mkdir(dirname(asset.filePath), { recursive: true });
      await writeFile(asset.filePath, asset.source);
    }),
  );
}
