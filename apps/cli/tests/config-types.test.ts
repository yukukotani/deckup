import { expect, test } from "vite-plus/test";

import {
  defineConfig,
  type SlidaRuntimePaths,
  type SlidaConfig,
  type SlidaResolvedTheme,
  type SlidaResolvedThemeLayout,
} from "../src/index.ts";
import * as slida from "../src/index.ts";

test("defineConfig returns an object config", () => {
  const config = defineConfig({ port: 3000 });
  expect(config).toEqual({ port: 3000 });
});

const validConfig = defineConfig({
  port: 3000,
  theme: "minimal",
  astro: {
    integrations: [],
    vite: {
      plugins: [],
    },
  },
});

const assignableConfig: SlidaConfig = validConfig;
expect(assignableConfig.port).toBe(3000);
expect(assignableConfig.theme).toBe("minimal");

const themedConfig = defineConfig({ theme: "bold" });
expect(themedConfig.theme).toBe("bold");

const packageThemeConfig = defineConfig({ theme: "@acme/slida-layout-theme" });
expect(packageThemeConfig.theme).toBe("@acme/slida-layout-theme");

const publicResolvedThemeLayout: SlidaResolvedThemeLayout = {
  id: "two-column",
  filePath: "/theme/layouts/two-column.astro",
  importPath: "/@fs/theme/layouts/two-column.astro",
  slotNames: ["left", "right"],
};
expect(publicResolvedThemeLayout.slotNames).toEqual(["left", "right"]);

const publicResolvedTheme: SlidaResolvedTheme = {
  name: "@acme/slida-layout-theme",
  filePath: "/theme/package.json",
  packageName: "@acme/slida-layout-theme",
  packageRoot: "/theme",
  layoutsDir: "/theme/layouts",
  layouts: [publicResolvedThemeLayout],
  slotNames: ["left", "right"],
  source: "package",
};
expect(publicResolvedTheme.layoutsDir).toBe("/theme/layouts");
expect(publicResolvedTheme.slotNames).toEqual(["left", "right"]);

const publicRuntimePaths: SlidaRuntimePaths = {
  projectRoot: "/deck",
  runtimeSourceDir: "/deck/node_modules/@slida/cli/runtime",
  runtimeOutDir: "/deck/.slida/runtime",
  generatedPageFilePath: "/deck/.slida/runtime/generated/Page.astro",
};
expect(publicRuntimePaths.generatedPageFilePath).toContain("generated/Page.astro");

expect("resolveSlidaTheme" in slida).toBe(false);
// @ts-expect-error resolveSlidaTheme was intentionally removed; use resolveSlidaThemeLayouts
void slida.resolveSlidaTheme;

defineConfig({
  // @ts-expect-error Theme config remains a string selector for layout-component packages
  theme: { name: "minimal" },
});

defineConfig({
  // @ts-expect-error Deck selection is a CLI/API option, not slida.config.* surface
  deckFile: "slides/deck.astro",
});

defineConfig({
  astro: {
    // @ts-expect-error Slida owns Astro root
    root: ".",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida owns Astro srcDir
    srcDir: ".slida/runtime",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida owns Astro external config loading
    configFile: "astro.config.ts",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida owns Astro output mode
    output: "server",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida exposes preview port as top-level port, not astro.server
    server: { port: 3000 },
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida owns Astro build output directory
    outDir: "dist",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida owns Astro log level through CLI/API options
    logLevel: "debug",
  },
});

defineConfig({
  astro: {
    // @ts-expect-error Slida keeps the Astro dev toolbar disabled
    devToolbar: { enabled: true },
  },
});
