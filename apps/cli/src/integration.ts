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
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const DECKUP_CLI_DECK_LAYOUT_MODULE_ID = "virtual:deckup/cli/deck-layout.astro";
const DECKUP_CLI_NAVIGATION_MODULE_ID = "virtual:deckup/cli/navigation.ts";
const resolvedDeckupCliDeckLayoutModuleId = DECKUP_CLI_DECK_LAYOUT_MODULE_ID;
const resolvedDeckupCliNavigationModuleId = `\0${DECKUP_CLI_NAVIGATION_MODULE_ID}`;

const require = createRequire(import.meta.url);

function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function resolveCoreRuntimeDir(): string | undefined {
  try {
    const corePackageJsonPath = require.resolve("@deckup/core/package.json");
    return join(dirname(corePackageJsonPath), "runtime");
  } catch {
    return undefined;
  }
}

function resolveCoreRuntimeFile(specifier: string): string | undefined {
  try {
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

function createCliDeckLayoutPlugin(): Plugin {
  const cssFilePath = resolveCoreRuntimeFile("@deckup/core/runtime/styles/global.css");
  const navigationFilePath = resolveCoreRuntimeFile("@deckup/core/runtime/scripts/navigation.ts");
  const cssModuleId = cssFilePath ? `/@fs/${normalizePath(cssFilePath)}` : undefined;

  return {
    name: "deckup:cli-deck-layout",
    resolveId(id) {
      if (id === DECKUP_CLI_DECK_LAYOUT_MODULE_ID) return resolvedDeckupCliDeckLayoutModuleId;
      if (id === DECKUP_CLI_NAVIGATION_MODULE_ID) return resolvedDeckupCliNavigationModuleId;
      return undefined;
    },
    load(id) {
      if (id === resolvedDeckupCliDeckLayoutModuleId) {
        if (!cssModuleId) return undefined;
        return createDeckLayoutSource({
          cssModuleId,
          navigationModuleId: DECKUP_CLI_NAVIGATION_MODULE_ID,
        });
      }
      if (id === resolvedDeckupCliNavigationModuleId) {
        return navigationFilePath ? readFileSync(navigationFilePath, "utf8") : undefined;
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
}

export function createDeckupCliIntegration(options: DeckupCliIntegrationOptions): AstroIntegration {
  const { registry, theme, generatedPageFilePath, codeHighlight } = options;
  const themeForDeck: DeckupThemeForDeck = () => theme;

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

        const coreRuntimeDir = resolveCoreRuntimeDir();
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
          ...(coreRuntimeDir ? [coreRuntimeDir] : []),
          ...existingFsAllow,
        ]).map(normalizePath);

        updateConfig({
          vite: {
            plugins: [
              createCliDeckLayoutPlugin(),
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
