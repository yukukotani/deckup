import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@deckup/cli";

export default defineConfig({
  port: 4321,
  theme: "default",
  astro: {
    vite: {
      plugins: [tailwindcss() as never],
      resolve: {
        alias: {
          "@slides": fileURLToPath(new URL("./slides", import.meta.url)),
        },
      },
    },
  },
});
