import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import {
  createAstroInlineConfig,
  DEFAULT_BUILD_OUT_DIR,
  normalizeBuildOutDir,
} from "../src/astro.ts";
import { prepareRuntime, resolveProjectRoot, resolveRuntimeSourceDir } from "../src/runtime.ts";

test("resolveProjectRoot returns an absolute project root", () => {
  expect(resolveProjectRoot(".")).toBe(process.cwd());
});

test("resolveRuntimeSourceDir points at the package runtime directory", () => {
  expect(resolveRuntimeSourceDir()).toBe(resolve(process.cwd(), "runtime"));
});

test("normalizeBuildOutDir resolves the default output under the project root", () => {
  const root = resolve("/tmp/slida-project");
  expect(normalizeBuildOutDir(root)).toBe(join(root, DEFAULT_BUILD_OUT_DIR));
});

test("createAstroInlineConfig disables external config and wires runtime dirs", () => {
  const root = resolve("/tmp/slida-project");
  const config = createAstroInlineConfig(
    {
      projectRoot: root,
      runtimeSourceDir: join(root, "node_modules/@slida/cli/runtime"),
      runtimeOutDir: join(root, ".slida/runtime"),
    },
    { outDir: "public-deck", logLevel: "warn" },
  );

  expect(config.root).toBe(root);
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBe(join(root, ".slida/runtime"));
  expect(config.outDir).toBe(join(root, "public-deck"));
  expect(config.logLevel).toBe("warn");
});

test("prepareRuntime writes a fallback page when the selected runtime source is absent", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-runtime-"));
  try {
    const missingRuntimeSource = join(projectRoot, "missing-runtime");
    const paths = await prepareRuntime(projectRoot, missingRuntimeSource);
    const fallback = await readFile(join(paths.runtimeOutDir, "pages/index.astro"), "utf8");
    expect(paths.runtimeSourceDir).toBe(missingRuntimeSource);
    expect(fallback).toContain("Slida runtime unavailable");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
