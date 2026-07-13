import { expect, test } from "vite-plus/test";

import {
  defineConfig,
  exportDeckPng,
  type DeckupBuildCommandOptions,
  type DeckupBuiltInIntegrationsConfig,
  type DeckupRuntimePaths,
  type DeckupConfig,
  type DeckupOutputFormat,
  type DeckupPngExportOptions,
  type DeckupPngExportResult,
  type DeckupResolvedTheme,
  type DeckupResolvedThemeLayout,
  type DeckupTailwindOptions,
} from "../src/index.ts";
import * as deckup from "../src/index.ts";

test("defineConfig returns an object config", () => {
  const config = defineConfig({ port: 3000 });
  expect(config).toEqual({ port: 3000 });
});

const tailwindOptions: DeckupTailwindOptions = {
  optimize: { minify: false },
};
const builtInIntegrations: DeckupBuiltInIntegrationsConfig = {
  tailwind: tailwindOptions,
};

const validConfig = defineConfig({
  port: 3000,
  theme: "minimal",
  integrations: builtInIntegrations,
  astro: {
    integrations: [],
    vite: {
      plugins: [],
    },
  },
});

const assignableConfig: DeckupConfig = validConfig;
expect(assignableConfig.port).toBe(3000);
expect(assignableConfig.theme).toBe("minimal");

const emptyBuiltInIntegrations = defineConfig({ integrations: {} });
expect(emptyBuiltInIntegrations.integrations).toEqual({});
const defaultTailwind = defineConfig({ integrations: { tailwind: {} } });
expect(defaultTailwind.integrations?.tailwind).toEqual({});
const disabledTailwind = defineConfig({ integrations: { tailwind: false } });
expect(disabledTailwind.integrations?.tailwind).toBe(false);

defineConfig({
  integrations: {
    // @ts-expect-error Deckup built-in integrations expose known keys only
    unknown: {},
  },
});

defineConfig({
  integrations: {
    // @ts-expect-error Tailwind accepts its options object or false, not true
    tailwind: true,
  },
});

defineConfig({
  integrations: {
    // @ts-expect-error Tailwind config is not an array
    tailwind: [],
  },
});

defineConfig({
  integrations: {
    // @ts-expect-error Tailwind config is not a string
    tailwind: "disabled",
  },
});

defineConfig({
  integrations: {
    tailwind: {
      // @ts-expect-error optimize must be a boolean or an object
      optimize: "always",
    },
  },
});

defineConfig({
  integrations: {
    tailwind: {
      optimize: {
        // @ts-expect-error minify must be a boolean
        minify: "yes",
      },
    },
  },
});

const themedConfig = defineConfig({ theme: "google-basic" });
expect(themedConfig.theme).toBe("google-basic");

const packageThemeConfig = defineConfig({ theme: "@acme/deckup-layout-theme" });
expect(packageThemeConfig.theme).toBe("@acme/deckup-layout-theme");

const npmThemeConfig = defineConfig({ theme: "npm:@acme/deckup-theme@1.2.3" });
expect(npmThemeConfig.theme).toBe("npm:@acme/deckup-theme@1.2.3");

const publicResolvedThemeLayout: DeckupResolvedThemeLayout = {
  id: "two-column",
  filePath: "/theme/layouts/two-column.astro",
  importPath: "/@fs/theme/layouts/two-column.astro",
  hasDefaultSlot: true,
  slotNames: ["left", "right"],
};
expect(publicResolvedThemeLayout.hasDefaultSlot).toBe(true);
expect(publicResolvedThemeLayout.slotNames).toEqual(["left", "right"]);

const publicResolvedTheme: DeckupResolvedTheme = {
  name: "@acme/deckup-layout-theme",
  filePath: "/theme/package.json",
  packageName: "@acme/deckup-layout-theme",
  packageRoot: "/theme",
  layoutsDir: "/theme/layouts",
  layouts: [publicResolvedThemeLayout],
  slotNames: ["left", "right"],
  source: "package",
};
expect(publicResolvedTheme.layoutsDir).toBe("/theme/layouts");
expect(publicResolvedTheme.slotNames).toEqual(["left", "right"]);

const publicRuntimePaths: DeckupRuntimePaths = {
  projectRoot: "/deck",
  runtimeSourceDir: "/deck/node_modules/deckup/runtime",
  runtimeOutDir: "/deck/.deckup/runtime",
  generatedPageFilePath: "/deck/.deckup/runtime/generated/Page.astro",
};
expect(publicRuntimePaths.generatedPageFilePath).toContain("generated/Page.astro");

const publicOutputFormat: DeckupOutputFormat = "pdf";
expect(publicOutputFormat).toBe("pdf");

const publicPngOutputFormat: DeckupOutputFormat = "png";
expect(publicPngOutputFormat).toBe("png");

const publicBuildCommandOptions: DeckupBuildCommandOptions = {
  deckFile: "slides/deck.mdx",
  format: publicOutputFormat,
  outDir: "dist",
  out: "deck.pdf",
  force: false,
  logLevel: "info",
};
expect(publicBuildCommandOptions.format).toBe("pdf");

const publicPngExportOptions: DeckupPngExportOptions = {
  deckFile: "slides/deck.mdx",
  outDir: "dist",
  out: "deck-images",
  slides: "1,3-5",
  browserExecutablePath: "/browser/chromium",
};
expect(publicPngExportOptions.slides).toBe("1,3-5");

const publicPngExportResult: DeckupPngExportResult = {
  outDir: "/project/dist",
  htmlFile: "/project/dist/index.html",
  pngDir: "/project/deck-images",
  pngFiles: ["/project/deck-images/slide-001.png"],
  url: "http://127.0.0.1:4321/",
};
expect(publicPngExportResult.pngFiles).toHaveLength(1);
expect(typeof exportDeckPng).toBe("function");

expect("resolveDeckupTheme" in deckup).toBe(false);
// @ts-expect-error resolveDeckupTheme was intentionally removed; use resolveDeckupThemeLayouts
void deckup.resolveDeckupTheme;
expect("parseNpmThemeSource" in deckup).toBe(false);
expect("resolveCachedNpmThemePackage" in deckup).toBe(false);
expect("DECKUP_THEME_CACHE_ENV" in deckup).toBe(false);
expect("normalizeDevValues" in deckup).toBe(false);
// @ts-expect-error normalizeDevValues was intentionally replaced by normalizeOpenValues
void deckup.normalizeDevValues;
expect("normalizeExportValues" in deckup).toBe(false);
// @ts-expect-error normalizeExportValues was intentionally removed with the export command surface
void deckup.normalizeExportValues;

// @ts-expect-error npm theme cache options are internal, not public package types
type PublicNpmThemeOptions = import("../src/index.ts").DeckupNpmThemeOptions;
expect(undefined as unknown as PublicNpmThemeOptions).toBeUndefined();

// @ts-expect-error npm theme download request is internal, not a public package type
type PublicNpmDownloadRequest = import("../src/index.ts").DeckupNpmThemeDownloadRequest;
expect(undefined as unknown as PublicNpmDownloadRequest).toBeUndefined();

defineConfig({
  // @ts-expect-error Theme config remains a string selector for layout-component packages
  theme: { name: "minimal" },
});

defineConfig({
  // @ts-expect-error npm theme cache location is controlled by DECKUP_THEME_CACHE_DIR, not deckup.config.*
  themeCacheDir: ".deckup-theme-cache",
});

defineConfig({
  // @ts-expect-error npm theme cacheDir is an internal resolver option, not deckup.config.*
  cacheDir: ".deckup-theme-cache",
});

defineConfig({
  // @ts-expect-error npm theme confirmation is internal resolver behavior, not deckup.config.*
  confirmDownload: async () => true,
});

defineConfig({
  // @ts-expect-error Deck selection is a CLI/API option, not deckup.config.* surface
  deckFile: "slides/deck.astro",
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup owns Astro root
    root: ".",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup owns Astro srcDir
    srcDir: ".deckup/runtime",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup owns Astro external config loading
    configFile: "astro.config.ts",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup owns Astro output mode
    output: "server",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup exposes preview port as top-level port, not astro.server
    server: { port: 3000 },
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup owns Astro build output directory
    outDir: "dist",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup owns Astro log level through CLI/API options
    logLevel: "debug",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Deckup keeps the Astro dev toolbar disabled
    devToolbar: { enabled: true },
  },
});
