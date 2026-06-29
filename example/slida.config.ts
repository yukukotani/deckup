import { fileURLToPath } from "node:url";

import { defineConfig } from "@slida/cli";

export default defineConfig({
  port: 4321,
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
