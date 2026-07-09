import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  createDeckupVitePluginsForRegistry,
  normalizePath,
  remarkDeckupMdxPages,
  resolveDeckRegistry,
  resolveDeckupThemeLayouts,
  uniqueStrings,
  type DeckupDeckRegistry,
  type DeckupResolvedDeck,
  type DeckupResolvedDeckRoute,
  type DeckupResolvedTheme,
  type DeckupThemeForDeck,
} from "@deckup/core";
import type { AstroIntegration } from "astro";
import { readFileSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export interface DeckupAstroOptions {
  decks: string | string[];
  base?: string;
  /**
   * Optional fallback theme for registered decks.
   * Deck frontmatter `theme` takes precedence over this value.
   */
  theme?: unknown;
}

const DEFAULT_DECKUP_BASE = "/slides";
const DECKUP_ASTRO_DECK_LAYOUT_MODULE_ID = "virtual:deckup/astro/deck-layout.astro";
const DECKUP_ASTRO_NAVIGATION_MODULE_ID = "virtual:deckup/astro/navigation.ts";
const resolvedDeckupAstroDeckLayoutModuleId = DECKUP_ASTRO_DECK_LAYOUT_MODULE_ID;
const resolvedDeckupAstroNavigationModuleId = `\0${DECKUP_ASTRO_NAVIGATION_MODULE_ID}`;
const staticPageFilePath = fileURLToPath(
  new URL("../runtime/components/Page.astro", import.meta.url),
);
const runtimeStylesFilePath = fileURLToPath(
  new URL("../runtime/styles/global.css", import.meta.url),
);
const runtimeNavigationFilePath = fileURLToPath(
  new URL("../runtime/scripts/navigation.js", import.meta.url),
);
type AliasEntry = { find: string | RegExp; replacement: string };

const require = createRequire(import.meta.url);
const astroPackageRoot = dirname(require.resolve("astro/package.json"));
const requiredAstroAliases: AliasEntry[] = [
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

function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeAliasEntries(alias: unknown): AliasEntry[] {
  if (alias === undefined) return [];
  if (Array.isArray(alias)) return alias as AliasEntry[];
  if (typeof alias === "object" && alias !== null) {
    return Object.entries(alias)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([find, replacement]) => ({ find, replacement }));
  }
  return [];
}

function hasThemeLayouts(theme: DeckupResolvedTheme | undefined) {
  return (theme?.layouts?.length ?? 0) > 0;
}

function isCoreCompatibleTheme(value: unknown): value is DeckupResolvedTheme {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DeckupResolvedTheme>;
  return (
    typeof candidate.name === "string" &&
    (candidate.source === "builtin" || candidate.source === "package") &&
    Array.isArray(candidate.layouts)
  );
}

function uniqueThemes(themes: Array<DeckupResolvedTheme | undefined>) {
  const byName = new Map<string, DeckupResolvedTheme>();
  for (const theme of themes) {
    if (theme && hasThemeLayouts(theme)) byName.set(theme.name, theme);
  }
  return [...byName.values()];
}

async function resolveFallbackTheme(projectRoot: string, theme: unknown) {
  if (isCoreCompatibleTheme(theme) && hasThemeLayouts(theme)) return theme;
  return resolveDeckupThemeLayouts(projectRoot, theme);
}

async function resolveEffectiveThemes(
  projectRoot: string,
  registry: DeckupDeckRegistry,
  fallbackTheme: DeckupResolvedTheme,
) {
  const byRouteId = new Map<string, DeckupResolvedTheme>();
  const byThemeName = new Map<string, Promise<DeckupResolvedTheme>>();
  await Promise.all(
    registry.decks.map(async (deck) => {
      const deckTheme = deck.metadata?.theme;
      if (deckTheme === undefined) {
        byRouteId.set(deck.routeId, fallbackTheme);
        return;
      }
      try {
        const resolved =
          byThemeName.get(deckTheme) ?? resolveDeckupThemeLayouts(projectRoot, deckTheme);
        byThemeName.set(deckTheme, resolved);
        byRouteId.set(deck.routeId, await resolved);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Invalid Deckup theme metadata in ${deck.projectRelativePath}: ${message}`,
          {
            cause: error,
          },
        );
      }
    }),
  );
  return byRouteId;
}

async function writeGeneratedPageComponent(projectRoot: string, themes: DeckupResolvedTheme[]) {
  const resolvedThemes = uniqueThemes(themes);
  if (resolvedThemes.length === 0) return undefined;

  const generatedPageFilePath = join(projectRoot, ".deckup", "astro", "generated", "Page.astro");
  const slotNames = uniqueStrings(resolvedThemes.flatMap((theme) => theme.slotNames ?? [])).sort();
  await mkdir(dirname(generatedPageFilePath), { recursive: true });
  await writeFile(
    generatedPageFilePath,
    createGeneratedPageComponentSource(
      slotNames,
      VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
      resolvedThemes[0]?.name,
    ),
  );
  return generatedPageFilePath;
}

function routeEntryFilePath(projectRoot: string, deck: DeckupResolvedDeckRoute) {
  return join(projectRoot, ".deckup", "astro", "routes", `${deck.routeId}.astro`);
}

async function writeRouteEntryFiles(projectRoot: string, registry: DeckupDeckRegistry) {
  // Astro's `injectRoute()` expects a file-backed entrypoint; Vite virtual module IDs
  // fail manifest creation before Vite's resolver runs. Keep each route file tiny and
  // delegate all runtime behavior to the per-deck virtual route module.
  const entries = await Promise.all(
    registry.decks.map(async (deck) => {
      const entrypoint = routeEntryFilePath(projectRoot, deck);
      await mkdir(dirname(entrypoint), { recursive: true });
      await writeFile(
        entrypoint,
        `---
import DeckupRoute from ${JSON.stringify(deck.virtualRouteModuleId)};
---

<DeckupRoute />
`,
      );
      return { deck, entrypoint };
    }),
  );
  return entries;
}

function routeDeckDirectories(registry: DeckupDeckRegistry) {
  return registry.decks.map((deck) => dirname(deck.filePath));
}

function themeFileSystemAllowEntries(themes: DeckupResolvedTheme[]) {
  return uniqueStrings(
    themes
      .flatMap((theme) => [
        theme.filePath ? dirname(theme.filePath) : undefined,
        theme.packageRoot,
        theme.layoutsDir,
        ...(theme.layouts?.map((layout) => dirname(layout.filePath)) ?? []),
      ])
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
  );
}

function createMdxIntegration(registry: DeckupDeckRegistry, themeForDeck: DeckupThemeForDeck) {
  return mdx({
    processor: unified({
      remarkPlugins: [
        [
          remarkDeckupMdxPages,
          { registry, themeForDeck: (deck: DeckupResolvedDeck) => themeForDeck(deck)?.name },
        ] as never,
      ],
    }),
  });
}

function createDeckLayoutSource() {
  const runtimeStylesImportPath = `/@fs/${normalizePath(runtimeStylesFilePath)}`;

  return `---
import ${JSON.stringify(runtimeStylesImportPath)};

interface Props {
  slideCount: number;
  title?: string;
}

const { slideCount, title = "Deckup Deck" } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="generator" content="Deckup" />
    <title>{title}</title>
  </head>
  <body>
    <div class="deckup-shell" data-deckup-shell data-slide-count={slideCount}>
      <slot />
    </div>
    <nav class="deckup-navigation deckup-status" data-deckup-navigation aria-label="Slide navigation">
      <button
        type="button"
        class="deckup-navigation__handle"
        data-deckup-nav-drag-handle
        aria-label="Move navigation menu"
        title="Move navigation menu"
      >
        ⋮⋮
      </button>
      <button
        type="button"
        class="deckup-navigation__button"
        data-deckup-nav-prev
        aria-label="Previous slide"
        disabled
      >
        ‹
      </button>
      <span class="deckup-navigation__status" aria-live="polite">
        <span data-deckup-current>1</span>/<span data-deckup-total>{Math.max(slideCount, 1)}</span>
      </span>
      <button
        type="button"
        class="deckup-navigation__button"
        data-deckup-nav-next
        aria-label="Next slide"
        disabled={slideCount <= 1}
      >
        ›
      </button>
      <button
        type="button"
        class="deckup-navigation__button"
        data-deckup-nav-fullscreen
        aria-label="Enter fullscreen"
        aria-pressed="false"
        title="Enter fullscreen"
      >
        ⛶
      </button>
    </nav>
    <script>
      import "virtual:deckup/astro/navigation.ts";
    </script>
  </body>
</html>
`;
}

function createNavigationSource() {
  return readFileSync(runtimeNavigationFilePath, "utf8");
}

function createDeckupAstroDeckLayoutPlugin(): Plugin {
  return {
    name: "deckup:astro-deck-layout",
    resolveId(id) {
      if (id === DECKUP_ASTRO_DECK_LAYOUT_MODULE_ID) return resolvedDeckupAstroDeckLayoutModuleId;
      if (id === DECKUP_ASTRO_NAVIGATION_MODULE_ID) return resolvedDeckupAstroNavigationModuleId;
      return undefined;
    },
    load(id) {
      if (id === resolvedDeckupAstroDeckLayoutModuleId) return createDeckLayoutSource();
      if (id === resolvedDeckupAstroNavigationModuleId) return createNavigationSource();
      return undefined;
    },
  };
}

export default function deckup(options: DeckupAstroOptions): AstroIntegration {
  return {
    name: "@deckup/astro",
    hooks: {
      async "astro:config:setup"({ config, injectRoute, updateConfig }) {
        const projectRoot = await realpath(fileURLToPath(config.root));
        const registry = await resolveDeckRegistry(
          projectRoot,
          options.decks,
          options.base ?? DEFAULT_DECKUP_BASE,
        );
        const fallbackTheme = await resolveFallbackTheme(projectRoot, options.theme);
        const themeByRouteId = await resolveEffectiveThemes(projectRoot, registry, fallbackTheme);
        const themeForDeck: DeckupThemeForDeck = (deck) =>
          themeByRouteId.get((deck as DeckupResolvedDeckRoute).routeId);
        const effectiveThemes = uniqueThemes([...themeByRouteId.values()]);
        const generatedPageFilePath = await writeGeneratedPageComponent(
          projectRoot,
          effectiveThemes,
        );
        const routeEntries = await writeRouteEntryFiles(projectRoot, registry);

        for (const { deck, entrypoint } of routeEntries) {
          injectRoute({
            pattern: deck.routePath,
            entrypoint,
          });
        }

        // Rolldown does not reliably resolve the package export for an Astro component
        // from symlinked workspace/temp hosts, so alias both themed and fallback Page
        // surfaces to concrete files.
        const pageAlias = [
          {
            find: /^@deckup\/astro\/page$/,
            replacement: generatedPageFilePath ?? staticPageFilePath,
          },
        ];
        const existingAliases = normalizeAliasEntries(config.vite?.resolve?.alias);
        const existingFsAllow = toStringArray(config.vite?.server?.fs?.allow);
        const fsAllow = uniqueStrings([
          projectRoot,
          dirname(staticPageFilePath),
          dirname(runtimeStylesFilePath),
          dirname(runtimeNavigationFilePath),
          ...routeDeckDirectories(registry),
          ...themeFileSystemAllowEntries(effectiveThemes),
          ...(generatedPageFilePath ? [dirname(generatedPageFilePath)] : []),
          ...routeEntries.map(({ entrypoint }) => dirname(entrypoint)),
          ...existingFsAllow,
        ]).map(normalizePath);

        updateConfig({
          integrations: [createMdxIntegration(registry, themeForDeck)],
          vite: {
            plugins: [
              createDeckupAstroDeckLayoutPlugin(),
              ...createDeckupVitePluginsForRegistry(registry, themeForDeck, {
                generatedPageFilePath,
                deckLayoutModuleId: DECKUP_ASTRO_DECK_LAYOUT_MODULE_ID,
              }),
            ],
            resolve: {
              alias: [...pageAlias, ...requiredAstroAliases, ...existingAliases],
            },
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
