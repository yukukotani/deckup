import { defineConfig } from "vite-plus";

const cliBuildDependency: Array<{ task: string; from: "devDependencies" }> = [
  { task: "build", from: "devDependencies" },
];

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "node ../apps/cli/dist/cli.mjs open slides/deck.astro",
        dependsOn: cliBuildDependency,
        cache: false,
      },
      "dev:astro": {
        command: "node ../apps/cli/dist/cli.mjs open slides/deck.astro",
        dependsOn: cliBuildDependency,
        cache: false,
      },
      "dev:mdx": {
        command: "node ../apps/cli/dist/cli.mjs open slides/deck.mdx",
        dependsOn: cliBuildDependency,
        cache: false,
      },
      build: {
        command: [
          "node ../apps/cli/dist/cli.mjs build slides/deck.astro --format html",
          "node ../apps/cli/dist/cli.mjs build slides/deck.mdx --format html",
        ],
        dependsOn: cliBuildDependency,
      },
      "build:astro": {
        command: "node ../apps/cli/dist/cli.mjs build slides/deck.astro --format html",
        dependsOn: cliBuildDependency,
      },
      "build:mdx": {
        command: "node ../apps/cli/dist/cli.mjs build slides/deck.mdx --format html",
        dependsOn: cliBuildDependency,
      },
      "build:pdf:mdx": {
        command: "node ../apps/cli/dist/cli.mjs build slides/deck.mdx --format pdf",
        dependsOn: cliBuildDependency,
      },
    },
  },
});
