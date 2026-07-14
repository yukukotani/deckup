import { defineConfig } from "vite-plus";

const cliSourceCommand = "node --conditions=development ../apps/cli/src/cli.ts";
const cliDistCommand = "node ../apps/cli/dist/cli.mjs";
// React 19 must load its server renderer in the same mode as Astro's static build.
const productionEnvironment = "NODE_ENV=production";
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
          `${productionEnvironment} ${cliDistCommand} build slides/deck.astro --format html`,
          `${productionEnvironment} ${cliDistCommand} build slides/deck.mdx --format html`,
        ],
        dependsOn: cliBuildDependency,
      },
      "build:astro": {
        command: `${productionEnvironment} ${cliDistCommand} build slides/deck.astro --format html`,
        dependsOn: cliBuildDependency,
      },
      "build:mdx": {
        command: `${productionEnvironment} ${cliDistCommand} build slides/deck.mdx --format html`,
        dependsOn: cliBuildDependency,
      },
      "build:pdf:mdx": {
        command: `${productionEnvironment} ${cliDistCommand} build slides/deck.mdx --format pdf`,
        dependsOn: cliBuildDependency,
      },
    },
  },
});
