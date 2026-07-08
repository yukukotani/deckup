import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "astro build",
        dependsOn: ["@slida/core#build", "@slida/astro#build"],
      },
    },
  },
});
