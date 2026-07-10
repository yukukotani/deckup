import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "cd ../.. && node --conditions=development apps/cli/src/cli.ts",
        cache: false,
      },
    },
  },
});
