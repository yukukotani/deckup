import {
  createDeckLayoutSource,
  createDeckupVitePluginsForRegistry,
  normalizePath,
  uniqueStrings,
  type DeckupDeckRegistry,
  type DeckupResolvedTheme,
  type DeckupThemeForDeck,
  type RawAstroCodeHighlightOptions,
} from "@deckup/core";
import type { AstroIntegration } from "astro";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const DECKUP_CLI_DECK_LAYOUT_MODULE_ID = "virtual:deckup/cli/deck-layout.astro";
const DECKUP_CLI_NAVIGATION_MODULE_ID = "virtual:deckup/cli/navigation.ts";
const resolvedDeckupCliDeckLayoutModuleId = DECKUP_CLI_DECK_LAYOUT_MODULE_ID;

const require = createRequire(import.meta.url);

/** @internal Test seam; not exported from the package index. */
export type ResolveCoreRuntimeSpecifier = (specifier: string) => string;

function defaultResolveCoreRuntimeSpecifier(specifier: string): string {
  return require.resolve(specifier);
}

/** @internal Test seam; not exported from the package index. */
export function resolveRequiredCoreRuntimeAsset(
  specifier: string,
  resolveSpecifier: ResolveCoreRuntimeSpecifier = defaultResolveCoreRuntimeSpecifier,
): string {
  try {
    return resolveSpecifier(specifier);
  } catch (error) {
    throw new Error(`Deckup CLI could not resolve required Core runtime asset "${specifier}".`, {
      cause: error,
    });
  }
}

interface DeckupCoreRuntimeAssets {
  runtimeDir: string;
  cssModuleId: string;
  navigationFilePath: string;
}

function resolveCoreRuntimeAssets(
  resolveSpecifier: ResolveCoreRuntimeSpecifier = defaultResolveCoreRuntimeSpecifier,
): DeckupCoreRuntimeAssets {
  const corePackageJsonPath = resolveRequiredCoreRuntimeAsset(
    "@deckup/core/package.json",
    resolveSpecifier,
  );
  const cssFilePath = resolveRequiredCoreRuntimeAsset(
    "@deckup/core/runtime/styles/global.css",
    resolveSpecifier,
  );
  const navigationFilePath = resolveRequiredCoreRuntimeAsset(
    "@deckup/core/runtime/scripts/navigation.ts",
    resolveSpecifier,
  );

  return {
    runtimeDir: join(dirname(corePackageJsonPath), "runtime"),
    cssModuleId: `/@fs/${normalizePath(cssFilePath)}`,
    navigationFilePath,
  };
}

function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function createCliDeckLayoutPlugin(assets: DeckupCoreRuntimeAssets): Plugin {
  return {
    name: "deckup:cli-deck-layout",
    resolveId(id) {
      if (id === DECKUP_CLI_DECK_LAYOUT_MODULE_ID) return resolvedDeckupCliDeckLayoutModuleId;
      if (id === DECKUP_CLI_NAVIGATION_MODULE_ID) {
        return normalizePath(assets.navigationFilePath);
      }
      return undefined;
    },
    load(id) {
      if (id === resolvedDeckupCliDeckLayoutModuleId) {
        return createDeckLayoutSource({
          cssModuleId: assets.cssModuleId,
          navigationModuleId: DECKUP_CLI_NAVIGATION_MODULE_ID,
        });
      }
      return undefined;
    },
  };
}

function routeEntryFilePath(projectRoot: string, routeId: string) {
  return join(projectRoot, ".deckup", "routes", `${routeId}.astro`);
}

async function writeRouteEntryFile(projectRoot: string, registry: DeckupDeckRegistry) {
  const deck = registry.decks[0];
  if (!deck) return [];

  const entrypoint = routeEntryFilePath(projectRoot, deck.routeId);
  await mkdir(dirname(entrypoint), { recursive: true });
  await writeFile(
    entrypoint,
    `---
import DeckupRoute from ${JSON.stringify(deck.virtualRouteModuleId)};
---

<DeckupRoute />
`,
  );
  return [{ deck, entrypoint }];
}

export interface DeckupCliIntegrationOptions {
  registry: DeckupDeckRegistry;
  theme?: DeckupResolvedTheme;
  generatedPageFilePath?: string;
  codeHighlight?: RawAstroCodeHighlightOptions;
  /** @internal Test seam; not exported from the package index. */
  resolveCoreRuntimeSpecifier?: ResolveCoreRuntimeSpecifier;
}

export function createDeckupCliIntegration(options: DeckupCliIntegrationOptions): AstroIntegration {
  const { registry, theme, generatedPageFilePath, codeHighlight, resolveCoreRuntimeSpecifier } =
    options;
  const themeForDeck: DeckupThemeForDeck = () => theme;
  const coreRuntimeAssets = resolveCoreRuntimeAssets(resolveCoreRuntimeSpecifier);
  const cliDeckLayoutPlugin = createCliDeckLayoutPlugin(coreRuntimeAssets);

  return {
    name: "deckup:cli",
    hooks: {
      async "astro:config:setup"({ config, injectRoute, updateConfig }) {
        const projectRoot = fileURLToPath(config.root);
        const routeEntries = await writeRouteEntryFile(projectRoot, registry);

        for (const { deck, entrypoint } of routeEntries) {
          injectRoute({
            pattern: deck.routePath,
            entrypoint,
          });
        }

        const existingFsAllow = toStringArray(config.vite?.server?.fs?.allow);
        const deckDirs = registry.decks.map((deck) => dirname(deck.filePath));
        const themeDirs = theme
          ? [
              theme.filePath ? dirname(theme.filePath) : undefined,
              theme.packageRoot,
              theme.layoutsDir,
              ...(theme.layouts?.map((layout) => dirname(layout.filePath)) ?? []),
            ].filter((dir): dir is string => typeof dir === "string" && dir.length > 0)
          : [];
        const fsAllow = uniqueStrings([
          projectRoot,
          ...deckDirs,
          ...themeDirs,
          ...(generatedPageFilePath ? [dirname(generatedPageFilePath)] : []),
          ...routeEntries.map(({ entrypoint }) => dirname(entrypoint)),
          coreRuntimeAssets.runtimeDir,
          ...existingFsAllow,
        ]).map(normalizePath);

        updateConfig({
          vite: {
            plugins: [
              cliDeckLayoutPlugin,
              ...createDeckupVitePluginsForRegistry(registry, themeForDeck, {
                generatedPageFilePath,
                deckLayoutModuleId: DECKUP_CLI_DECK_LAYOUT_MODULE_ID,
                codeHighlight,
              }),
            ],
            server: {
              fs: {
                allow: fsAllow,
                strict: true,
              },
            },
          },
        });
      },
    },
  };
}
