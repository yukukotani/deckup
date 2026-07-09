import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "astro build",
        dependsOn: ["@deckup/core#build", "@deckup/astro#build"],
      },
    },
  },
});
