import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

type PackageJson = {
  name?: string;
  private?: boolean;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports: Record<string, unknown>;
  files?: string[];
  scripts?: Record<string, string>;
};

type TsConfig = {
  compilerOptions?: {
    customConditions?: Array<string>;
  };
};

function readJson<T>(pathFromTest: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(pathFromTest, import.meta.url)), "utf8"),
  ) as T;
}

function readPackageJson(pathFromTest: string): PackageJson {
  return readJson<PackageJson>(pathFromTest);
}

function expectDevelopmentMainExport(packageJson: PackageJson) {
  expect(packageJson.exports["."]).toEqual({
    development: "./src/index.ts",
    default: "./dist/index.mjs",
  });
  expect(Object.keys(packageJson.exports["."] as Record<string, string>)).toEqual([
    "development",
    "default",
  ]);
}

function readText(pathFromTest: string): string {
  return readFileSync(fileURLToPath(new URL(pathFromTest, import.meta.url)), "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function taskBlock(source: string, taskName: string) {
  const taskKey = /^[a-z][\w-]*$/.test(taskName) ? taskName : JSON.stringify(taskName);
  const match = new RegExp(
    `\n      ${escapeRegExp(taskKey)}: \\{([\\s\\S]*?)\n      \\}`,
    "m",
  ).exec(source);
  expect(match, `Missing task ${taskName}`).toBeTruthy();
  return match?.[1] ?? "";
}

const cliPackageJson = readPackageJson("../package.json");
const rootPackageJson = readPackageJson("../../../package.json");
const astroPackageJson = readPackageJson("../../../packages/astro/package.json");
const corePackageJson = readPackageJson("../../../packages/core/package.json");
const exampleViteConfigSource = readText("../../../example/vite.config.ts");
const webPackageJson = readPackageJson("../../../apps/web/package.json");
const webAstroConfigSource = readText("../../../apps/web/astro.config.ts");
const cliTsConfig = readJson<TsConfig>("../tsconfig.json");
const astroTsConfig = readJson<TsConfig>("../../../packages/astro/tsconfig.json");
const coreTsConfig = readJson<TsConfig>("../../../packages/core/tsconfig.json");
const webTsConfig = readJson<TsConfig>("../../../apps/web/tsconfig.json");

test("workspace root and published CLI package names do not collide", () => {
  expect(rootPackageJson.name).toBe("root");
  expect(rootPackageJson.private).toBe(true);
  expect(cliPackageJson.name).toBe("deckup");
});

test("Deckup package main exports prefer source only for the development condition", () => {
  expectDevelopmentMainExport(cliPackageJson);
  expectDevelopmentMainExport(astroPackageJson);
  expectDevelopmentMainExport(corePackageJson);
});

test("Deckup package export maps preserve published runtime subpaths", () => {
  expect(cliPackageJson.bin?.deckup).toBe("./dist/cli.mjs");
  expect(cliPackageJson.files).toEqual(["dist"]);
  expect(cliPackageJson.exports["./package.json"]).toBe("./package.json");

  expect(astroPackageJson.exports["./page"]).toBe("./runtime/components/Page.astro");
  expect(readText("../../../packages/astro/runtime/components/Page.astro")).toContain(
    "@deckup/core/page",
  );
  expect(astroPackageJson.exports["./package.json"]).toBe("./package.json");

  expect(corePackageJson.files).toEqual(["dist", "runtime"]);
  expect(corePackageJson.exports["./page"]).toBe("./runtime/components/Page.astro");
  expect(corePackageJson.exports["./runtime/styles/global.css"]).toBe(
    "./runtime/styles/global.css",
  );
  expect(corePackageJson.exports["./runtime/scripts/navigation.ts"]).toBe(
    "./runtime/scripts/navigation.ts",
  );
  expect(corePackageJson.exports["./package.json"]).toBe("./package.json");
});

test("workspace type checks opt into source exports without requiring dist", () => {
  for (const tsConfig of [cliTsConfig, astroTsConfig, coreTsConfig, webTsConfig]) {
    expect(tsConfig.compilerOptions?.customConditions).toContain("development");
  }
});

test("example dev tasks run the source CLI with the development condition", () => {
  expect(exampleViteConfigSource).toContain(
    'const cliSourceCommand = "node --conditions=development ../apps/cli/src/cli.ts";',
  );

  for (const taskName of ["dev", "dev:astro", "dev:mdx"]) {
    const block = taskBlock(exampleViteConfigSource, taskName);
    expect(block).toContain("`${cliSourceCommand} open slides/");
    expect(block).toContain("cache: false");
    expect(block).not.toContain("dependsOn");
    expect(block).not.toContain("../apps/cli/dist/cli.mjs");
  }
});

test("example build tasks stay dist-backed and dependency-driven", () => {
  expect(exampleViteConfigSource).toContain(
    'const cliDistCommand = "node ../apps/cli/dist/cli.mjs";',
  );
  expect(exampleViteConfigSource).toContain(
    'const cliBuildDependency: Array<{ task: string; from: "devDependencies" }>',
  );

  for (const taskName of ["build", "build:astro", "build:mdx", "build:pdf:mdx"]) {
    const block = taskBlock(exampleViteConfigSource, taskName);
    expect(block).toContain("cliDistCommand");
    expect(block).toContain("dependsOn: cliBuildDependency");
  }
});

test("web dev opts into the development condition before Astro config loading", () => {
  expect(webPackageJson.scripts?.dev).toBe("NODE_OPTIONS=--conditions=development astro dev");
  expect(webPackageJson.scripts?.check).toBe("vp check");
  expect(webPackageJson.dependencies?.["@deckup/astro"]).toBe("workspace:*");
  expect(webAstroConfigSource).toContain('import deckup from "@deckup/astro";');
});
