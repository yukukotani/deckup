import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import vue from "@astrojs/vue";
import { defineConfig } from "deckup";

export default defineConfig({
  port: 4321,
  theme: "default",
  astro: {
    integrations: [react(), vue()],
    vite: {
      server: {
        fs: {
          allow: [fileURLToPath(new URL("..", import.meta.url))],
        },
      },
      resolve: {
        alias: {
          "@slides": fileURLToPath(new URL("./slides", import.meta.url)),
        },
      },
    },
  },
});
