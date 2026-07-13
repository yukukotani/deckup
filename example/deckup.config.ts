import { fileURLToPath } from "node:url";

import { defineConfig } from "deckup";

export default defineConfig({
  port: 4321,
  theme: "default",
  astro: {
    vite: {
      resolve: {
        alias: {
          "@slides": fileURLToPath(new URL("./slides", import.meta.url)),
        },
      },
    },
  },
});
