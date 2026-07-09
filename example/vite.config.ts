import { defineConfig } from "vite-plus";

const cliSourceCommand = "node --conditions=development ../apps/cli/src/cli.ts";
const cliDistCommand = "node ../apps/cli/dist/cli.mjs";
const cliBuildDependency: Array<{ task: string; from: "devDependencies" }> = [
  { task: "build", from: "devDependencies" },
];

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: `${cliSourceCommand} open slides/deck.astro`,
        cache: false,
      },
      "dev:astro": {
        command: `${cliSourceCommand} open slides/deck.astro`,
        cache: false,
      },
      "dev:mdx": {
        command: `${cliSourceCommand} open slides/deck.mdx`,
        cache: false,
      },
      build: {
        command: [
          `${cliDistCommand} build slides/deck.astro --format html`,
          `${cliDistCommand} build slides/deck.mdx --format html`,
        ],
        dependsOn: cliBuildDependency,
      },
      "build:astro": {
        command: `${cliDistCommand} build slides/deck.astro --format html`,
        dependsOn: cliBuildDependency,
      },
      "build:mdx": {
        command: `${cliDistCommand} build slides/deck.mdx --format html`,
        dependsOn: cliBuildDependency,
      },
      "build:pdf:mdx": {
        command: `${cliDistCommand} build slides/deck.mdx --format pdf`,
        dependsOn: cliBuildDependency,
      },
    },
  },
});
