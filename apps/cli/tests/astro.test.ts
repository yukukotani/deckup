import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import {
  buildDeck,
  createAstroInlineConfig,
  DEFAULT_BUILD_OUT_DIR,
  normalizeBuildOutDir,
} from "../src/astro.ts";
import { prepareRuntime, resolveProjectRoot, resolveRuntimeSourceDir } from "../src/runtime.ts";

const cliPackageRoot = fileURLToPath(new URL("..", import.meta.url));

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-astro-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function linkCliPackage(projectRoot: string) {
  const scopeDir = join(projectRoot, "node_modules", "@slida");
  await mkdir(scopeDir, { recursive: true });
  await symlink(cliPackageRoot, join(scopeDir, "cli"), "dir");
}

function slideCount(html: string) {
  return html.match(/data-slida-slide(?=[\s>])/g)?.length ?? 0;
}

test("resolveProjectRoot returns an absolute project root", () => {
  expect(resolveProjectRoot(".")).toBe(process.cwd());
});

test("resolveRuntimeSourceDir points at the package runtime directory", () => {
  expect(resolveRuntimeSourceDir()).toBe(fileURLToPath(new URL("../runtime", import.meta.url)));
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

test("buildDeck builds one selected Astro deck file", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
<Page title="Details"><h1>Details</h1></Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(2);
    expect(html).toContain('data-slide-count="2"');
    expect(html).toContain("Intro");
    expect(html).toContain("Details");
  });
});

test("buildDeck rejects a missing deck file option", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(buildDeck({ root: projectRoot, logLevel: "silent" })).rejects.toThrow(
      /Missing Slida deck file/,
    );
  });
});

test("buildDeck rejects Astro deck top-level content outside Page", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "bad.astro"),
      `---
import Page from "@slida/cli/page";
---

<h1>Loose content</h1>
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.astro", logLevel: "silent" }),
    ).rejects.toThrow(/top-level content must be <Page>/);
  });
});

test("buildDeck rejects Astro decks without the package Page import", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "bad.astro"),
      `---
---

<Page title="Intro"><h1>Intro</h1></Page>
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.astro", logLevel: "silent" }),
    ).rejects.toThrow(/import Page from/);
  });
});

test("buildDeck builds one selected MDX deck file split by dividers", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: MDX Deck
---

# Intro

---

# Details
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(2);
    expect(html).toContain('data-slide-count="2"');
    expect(html).toContain("MDX Deck");
    expect(html).toContain("Intro");
    expect(html).toContain("Details");
  });
});
