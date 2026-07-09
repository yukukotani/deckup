import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import {
  VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  createSlidaVitePluginsForRegistry,
  normalizePath,
  remarkSlidaMdxPages,
  resolveDeckRegistry,
  resolveSlidaThemeLayouts,
  uniqueStrings,
  type SlidaDeckRegistry,
  type SlidaResolvedDeck,
  type SlidaResolvedDeckRoute,
  type SlidaResolvedTheme,
  type SlidaThemeForDeck,
} from "@slida/core";
import type { AstroIntegration } from "astro";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export interface SlidaAstroOptions {
  decks: string | string[];
  base?: string;
  /**
   * Optional fallback theme for registered decks.
   * Deck frontmatter `theme` takes precedence over this value.
   */
  theme?: unknown;
}

const DEFAULT_SLIDA_BASE = "/slides";
const SLIDA_ASTRO_DECK_LAYOUT_MODULE_ID = "virtual:slida/astro/deck-layout.astro";
const SLIDA_ASTRO_NAVIGATION_MODULE_ID = "virtual:slida/astro/navigation.ts";
const resolvedSlidaAstroDeckLayoutModuleId = SLIDA_ASTRO_DECK_LAYOUT_MODULE_ID;
const resolvedSlidaAstroNavigationModuleId = `\0${SLIDA_ASTRO_NAVIGATION_MODULE_ID}`;
const staticPageFilePath = fileURLToPath(
  new URL("../runtime/components/Page.astro", import.meta.url),
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

function hasThemeLayouts(theme: SlidaResolvedTheme | undefined) {
  return (theme?.layouts?.length ?? 0) > 0;
}

function isCoreCompatibleTheme(value: unknown): value is SlidaResolvedTheme {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SlidaResolvedTheme>;
  return (
    typeof candidate.name === "string" &&
    (candidate.source === "builtin" || candidate.source === "package") &&
    Array.isArray(candidate.layouts)
  );
}

function uniqueThemes(themes: Array<SlidaResolvedTheme | undefined>) {
  const byName = new Map<string, SlidaResolvedTheme>();
  for (const theme of themes) {
    if (theme && hasThemeLayouts(theme)) byName.set(theme.name, theme);
  }
  return [...byName.values()];
}

async function resolveFallbackTheme(projectRoot: string, theme: unknown) {
  if (isCoreCompatibleTheme(theme) && hasThemeLayouts(theme)) return theme;
  return resolveSlidaThemeLayouts(projectRoot, theme);
}

async function resolveEffectiveThemes(
  projectRoot: string,
  registry: SlidaDeckRegistry,
  fallbackTheme: SlidaResolvedTheme,
) {
  const byRouteId = new Map<string, SlidaResolvedTheme>();
  const byThemeName = new Map<string, Promise<SlidaResolvedTheme>>();
  await Promise.all(
    registry.decks.map(async (deck) => {
      const deckTheme = deck.metadata?.theme;
      if (deckTheme === undefined) {
        byRouteId.set(deck.routeId, fallbackTheme);
        return;
      }
      try {
        const resolved =
          byThemeName.get(deckTheme) ?? resolveSlidaThemeLayouts(projectRoot, deckTheme);
        byThemeName.set(deckTheme, resolved);
        byRouteId.set(deck.routeId, await resolved);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid Slida theme metadata in ${deck.projectRelativePath}: ${message}`, {
          cause: error,
        });
      }
    }),
  );
  return byRouteId;
}

async function writeGeneratedPageComponent(projectRoot: string, themes: SlidaResolvedTheme[]) {
  const resolvedThemes = uniqueThemes(themes);
  if (resolvedThemes.length === 0) return undefined;

  const generatedPageFilePath = join(projectRoot, ".slida", "astro", "generated", "Page.astro");
  const slotNames = uniqueStrings(resolvedThemes.flatMap((theme) => theme.slotNames ?? [])).sort();
  await mkdir(dirname(generatedPageFilePath), { recursive: true });
  await writeFile(
    generatedPageFilePath,
    createGeneratedPageComponentSource(
      slotNames,
      VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
      resolvedThemes[0]?.name,
    ),
  );
  return generatedPageFilePath;
}

function routeEntryFilePath(projectRoot: string, deck: SlidaResolvedDeckRoute) {
  return join(projectRoot, ".slida", "astro", "routes", `${deck.routeId}.astro`);
}

async function writeRouteEntryFiles(projectRoot: string, registry: SlidaDeckRegistry) {
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
import SlidaRoute from ${JSON.stringify(deck.virtualRouteModuleId)};
---

<SlidaRoute />
`,
      );
      return { deck, entrypoint };
    }),
  );
  return entries;
}

function routeDeckDirectories(registry: SlidaDeckRegistry) {
  return registry.decks.map((deck) => dirname(deck.filePath));
}

function themeFileSystemAllowEntries(themes: SlidaResolvedTheme[]) {
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

function createMdxIntegration(registry: SlidaDeckRegistry, themeForDeck: SlidaThemeForDeck) {
  return mdx({
    processor: unified({
      remarkPlugins: [
        [
          remarkSlidaMdxPages,
          { registry, themeForDeck: (deck: SlidaResolvedDeck) => themeForDeck(deck)?.name },
        ] as never,
      ],
    }),
  });
}

function createDeckLayoutSource() {
  return `---
interface Props {
  slideCount: number;
  title?: string;
}

const { slideCount, title = "Slida Deck" } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="generator" content="Slida" />
    <title>{title}</title>
    <style is:inline>
      :root {
        color-scheme: dark;
        --slida-bg: #111;
        --slida-fg: #f8fafc;
        --slida-panel: rgb(15 23 42 / 0.76);
        --slida-border: rgb(148 163 184 / 0.24);
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
        background: var(--slida-bg);
        color: var(--slida-fg);
      }

      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .slida-shell {
        width: min(100vw, calc(100vh * 16 / 9));
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: #fff;
        color: #111827;
        container-type: size;
        box-shadow: 0 24px 80px rgb(0 0 0 / 0.45);
      }

      .slida-deck,
      .slida-empty,
      .slida-slide {
        width: 100%;
        height: 100%;
        min-height: 0;
      }

      .slida-slide:not(:first-child):not([data-active]) {
        display: none;
      }

      .slida-empty {
        display: grid;
        place-items: center;
        text-align: center;
        padding: 4rem;
        box-sizing: border-box;
      }

      .slida-kicker {
        margin: 0 0 0.75rem;
        font-size: 0.875rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #64748b;
      }

      .slida-status {
        position: fixed;
        left: 50%;
        bottom: 1rem;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0.65rem;
        border: 1px solid var(--slida-border);
        border-radius: 999px;
        background: var(--slida-panel);
        color: var(--slida-fg);
        -webkit-backdrop-filter: blur(16px);
        backdrop-filter: blur(16px);
        font: 500 0.875rem/1 ui-sans-serif, system-ui, sans-serif;
      }

      .slida-navigation__button,
      .slida-navigation__handle {
        width: 1.8rem;
        height: 1.8rem;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
      }

      .slida-navigation__button:not(:disabled),
      .slida-navigation__handle {
        cursor: pointer;
      }

      .slida-navigation__button:disabled {
        opacity: 0.42;
      }

      @media print {
        @page {
          size: 16in 9in;
          margin: 0;
        }

        body {
          display: block;
          background: #fff;
        }

        .slida-shell {
          width: 100vw;
          height: 100vh;
          aspect-ratio: auto;
          box-shadow: none;
        }

        .slida-slide,
        .slida-slide[hidden],
        .slida-slide:not(:first-child):not([data-active]) {
          display: block;
          height: 100vh;
          overflow: hidden;
          break-after: page;
          page-break-after: always;
        }

        [data-slida-navigation] {
          display: none !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="slida-shell" data-slida-shell data-slide-count={slideCount}>
      <slot />
    </div>
    <nav class="slida-navigation slida-status" data-slida-navigation aria-label="Slide navigation">
      <button
        type="button"
        class="slida-navigation__handle"
        data-slida-nav-drag-handle
        aria-label="Move navigation menu"
        title="Move navigation menu"
      >
        ⋮⋮
      </button>
      <button
        type="button"
        class="slida-navigation__button"
        data-slida-nav-prev
        aria-label="Previous slide"
        disabled
      >
        ‹
      </button>
      <span class="slida-navigation__status" aria-live="polite">
        <span data-slida-current>1</span>/<span data-slida-total>{Math.max(slideCount, 1)}</span>
      </span>
      <button
        type="button"
        class="slida-navigation__button"
        data-slida-nav-next
        aria-label="Next slide"
        disabled={slideCount <= 1}
      >
        ›
      </button>
      <button
        type="button"
        class="slida-navigation__button"
        data-slida-nav-fullscreen
        aria-label="Enter fullscreen"
        aria-pressed="false"
        title="Enter fullscreen"
      >
        ⛶
      </button>
    </nav>
    <script>
      import "virtual:slida/astro/navigation.ts";
    </script>
  </body>
</html>
`;
}

function createNavigationSource() {
  return `const slideSelector = "[data-slida-slide]";
const currentSelector = "[data-slida-current]";
const previousButtonSelector = "[data-slida-nav-prev]";
const nextButtonSelector = "[data-slida-nav-next]";
const fullscreenButtonSelector = "[data-slida-nav-fullscreen]";
const navigationMenuSelector = "[data-slida-navigation]";
const dragHandleSelector = "[data-slida-nav-drag-handle]";
const editableSelector = "input, textarea, select, button, [contenteditable=''], [contenteditable='true']";
const printModeAttribute = "data-slida-print";
const enterFullscreenLabel = "Enter fullscreen";
const exitFullscreenLabel = "Exit fullscreen";

function clampSlideIndex(index, total) {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

function parseSlideHash(hash, total) {
  const normalized = hash.trim().replace(/^#\\/?/, "");
  const numeric = normalized.startsWith("slide-") ? normalized.slice("slide-".length) : normalized;
  const parsed = Number.parseInt(numeric, 10);
  return Number.isFinite(parsed) ? clampSlideIndex(parsed - 1, total) : 0;
}

function getNextSlideIndex(current, delta, total) {
  return clampSlideIndex(current + delta, total);
}

function formatSlideHash(index) {
  return \`#\${index + 1}\`;
}

function clampMenuPosition(position, viewport, menu) {
  return {
    left: Math.min(Math.max(position.left, 0), Math.max(viewport.width - menu.width, 0)),
    top: Math.min(Math.max(position.top, 0), Math.max(viewport.height - menu.height, 0)),
  };
}

function isEditableTarget(target) {
  return target instanceof Element && target.closest(editableSelector) !== null;
}

function updateStatus(document, index) {
  const current = document.querySelector(currentSelector);
  if (current) current.textContent = String(index + 1);
}

function showSlide(slides, index, window = globalThis.window) {
  const nextIndex = clampSlideIndex(index, slides.length);
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === nextIndex;
    slide.hidden = !active;
    slide.setAttribute("aria-hidden", active ? "false" : "true");
    slide.toggleAttribute("data-active", active);
  });
  updateStatus(window.document, nextIndex);
  const nextHash = formatSlideHash(nextIndex);
  if (window.location.hash !== nextHash) window.history.replaceState(null, "", nextHash);
  return nextIndex;
}

function revealSlidesForPrint(document = globalThis.document) {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  const snapshots = slides.map((slide) => ({
    slide,
    hidden: slide.hidden,
    ariaHidden: slide.getAttribute("aria-hidden"),
    active: slide.hasAttribute("data-active"),
  }));
  document.documentElement.setAttribute(printModeAttribute, "");
  document.body?.setAttribute(printModeAttribute, "");
  for (const slide of slides) {
    slide.hidden = false;
    slide.setAttribute("aria-hidden", "false");
    slide.toggleAttribute("data-active", true);
  }
  return () => {
    for (const { slide, hidden, ariaHidden, active } of snapshots) {
      slide.hidden = hidden;
      if (ariaHidden === null) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", ariaHidden);
      slide.toggleAttribute("data-active", active);
    }
    document.documentElement.removeAttribute(printModeAttribute);
    document.body?.removeAttribute(printModeAttribute);
  };
}

function setupDeckNavigation(document = globalThis.document, window = globalThis.window) {
  const slides = Array.from(document.querySelectorAll(slideSelector));
  if (slides.length === 0) return undefined;
  const previousButton = document.querySelector(previousButtonSelector);
  const nextButton = document.querySelector(nextButtonSelector);
  const fullscreenButton = document.querySelector(fullscreenButtonSelector);
  const navigationMenu = document.querySelector(navigationMenuSelector);
  const dragHandle = document.querySelector(dragHandleSelector);
  let current = showSlide(slides, parseSlideHash(window.location.hash, slides.length), window);
  let dragState;
  let restorePrintMode;
  let fullscreenTransitionPending = false;
  const fullscreenSupported = () => document.fullscreenEnabled !== false && typeof document.documentElement.requestFullscreen === "function" && typeof document.exitFullscreen === "function";
  const syncFullscreenButton = () => {
    if (!fullscreenButton) return;
    const supported = fullscreenSupported();
    const active = document.fullscreenElement !== null;
    const label = active ? exitFullscreenLabel : enterFullscreenLabel;
    fullscreenButton.disabled = !supported || fullscreenTransitionPending;
    fullscreenButton.setAttribute("aria-label", label);
    fullscreenButton.setAttribute("aria-pressed", String(active));
    fullscreenButton.title = label;
  };
  const syncNavigationButtons = () => {
    if (previousButton) previousButton.disabled = current <= 0;
    if (nextButton) nextButton.disabled = current >= slides.length - 1;
  };
  const goTo = (index) => {
    current = showSlide(slides, index, window);
    syncNavigationButtons();
  };
  previousButton?.addEventListener("click", (event) => {
    event.preventDefault();
    goTo(getNextSlideIndex(current, -1, slides.length));
  });
  nextButton?.addEventListener("click", (event) => {
    event.preventDefault();
    goTo(getNextSlideIndex(current, 1, slides.length));
  });
  fullscreenButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!fullscreenSupported() || fullscreenTransitionPending) return;
    fullscreenTransitionPending = true;
    syncFullscreenButton();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreenButton?.focus();
    } finally {
      fullscreenTransitionPending = false;
      syncFullscreenButton();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) return;
    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        event.preventDefault();
        goTo(getNextSlideIndex(current, 1, slides.length));
        break;
      case "ArrowLeft":
      case "PageUp":
      case "Backspace":
        event.preventDefault();
        goTo(getNextSlideIndex(current, -1, slides.length));
        break;
      case "Home":
        event.preventDefault();
        goTo(0);
        break;
      case "End":
        event.preventDefault();
        goTo(slides.length - 1);
        break;
    }
  });
  window.addEventListener("hashchange", () => goTo(parseSlideHash(window.location.hash, slides.length)));
  window.addEventListener("beforeprint", () => {
    restorePrintMode?.();
    restorePrintMode = revealSlidesForPrint(document);
  });
  window.addEventListener("afterprint", () => {
    restorePrintMode?.();
    restorePrintMode = undefined;
  });
  dragHandle?.addEventListener("pointerdown", (event) => {
    if (!navigationMenu || dragState || event.button !== 0 || event.isPrimary === false) return;
    const rect = navigationMenu.getBoundingClientRect();
    dragState = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height };
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  window.addEventListener("pointermove", (event) => {
    if (!navigationMenu || !dragState || event.pointerId !== dragState.pointerId) return;
    const position = clampMenuPosition({ left: event.clientX - dragState.offsetX, top: event.clientY - dragState.offsetY }, { width: window.innerWidth, height: window.innerHeight }, { width: dragState.width, height: dragState.height });
    navigationMenu.style.left = \`\${position.left}px\`;
    navigationMenu.style.top = \`\${position.top}px\`;
    navigationMenu.style.right = "auto";
    navigationMenu.style.bottom = "auto";
    navigationMenu.style.transform = "none";
    event.preventDefault();
  });
  const endDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragHandle?.releasePointerCapture(dragState.pointerId);
    dragState = undefined;
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  syncNavigationButtons();
  syncFullscreenButton();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setupDeckNavigation(), { once: true });
  else setupDeckNavigation();
}
`;
}

function createSlidaAstroDeckLayoutPlugin(): Plugin {
  return {
    name: "slida:astro-deck-layout",
    resolveId(id) {
      if (id === SLIDA_ASTRO_DECK_LAYOUT_MODULE_ID) return resolvedSlidaAstroDeckLayoutModuleId;
      if (id === SLIDA_ASTRO_NAVIGATION_MODULE_ID) return resolvedSlidaAstroNavigationModuleId;
      return undefined;
    },
    load(id) {
      if (id === resolvedSlidaAstroDeckLayoutModuleId) return createDeckLayoutSource();
      if (id === resolvedSlidaAstroNavigationModuleId) return createNavigationSource();
      return undefined;
    },
  };
}

export default function slida(options: SlidaAstroOptions): AstroIntegration {
  return {
    name: "@slida/astro",
    hooks: {
      async "astro:config:setup"({ config, injectRoute, updateConfig }) {
        const projectRoot = await realpath(fileURLToPath(config.root));
        const registry = await resolveDeckRegistry(
          projectRoot,
          options.decks,
          options.base ?? DEFAULT_SLIDA_BASE,
        );
        const fallbackTheme = await resolveFallbackTheme(projectRoot, options.theme);
        const themeByRouteId = await resolveEffectiveThemes(projectRoot, registry, fallbackTheme);
        const themeForDeck: SlidaThemeForDeck = (deck) =>
          themeByRouteId.get((deck as SlidaResolvedDeckRoute).routeId);
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
            find: /^@slida\/astro\/page$/,
            replacement: generatedPageFilePath ?? staticPageFilePath,
          },
        ];
        const existingAliases = normalizeAliasEntries(config.vite?.resolve?.alias);
        const existingFsAllow = toStringArray(config.vite?.server?.fs?.allow);
        const fsAllow = uniqueStrings([
          projectRoot,
          dirname(staticPageFilePath),
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
              createSlidaAstroDeckLayoutPlugin(),
              ...createSlidaVitePluginsForRegistry(registry, themeForDeck, {
                generatedPageFilePath,
                deckLayoutModuleId: SLIDA_ASTRO_DECK_LAYOUT_MODULE_ID,
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
