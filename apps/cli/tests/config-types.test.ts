import { expect, test } from "vite-plus/test";

import { defineConfig, type SlidaConfig } from "../src/index.ts";

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

defineConfig({
  // @ts-expect-error Theme config is string-first in the initial API
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
