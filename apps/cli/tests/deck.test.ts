import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

import { inferDeckFormat, resolveDeckFile, SUPPORTED_DECK_EXTENSIONS } from "@slida/core";

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-deck-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

test("SUPPORTED_DECK_EXTENSIONS documents Astro and MDX deck support", () => {
  expect(SUPPORTED_DECK_EXTENSIONS).toEqual([".astro", ".mdx"]);
});

test("inferDeckFormat accepts Astro and MDX deck files", () => {
  expect(inferDeckFormat("slides/talk.astro")).toBe("astro");
  expect(inferDeckFormat("slides/talk.mdx")).toBe("mdx");
});

test("inferDeckFormat rejects unsupported deck extensions", () => {
  expect(() => inferDeckFormat("slides/talk.md")).toThrow(/Unsupported Slida deck file extension/);
});

test("resolveDeckFile resolves a project-relative deck file", async () => {
  await withProjectRoot(async (projectRoot) => {
    await mkdir(join(projectRoot, "slides"));
    await writeFile(join(projectRoot, "slides", "talk.astro"), "---\n---\n");

    await expect(resolveDeckFile(projectRoot, "slides/talk.astro")).resolves.toEqual({
      filePath: join(projectRoot, "slides", "talk.astro"),
      projectRelativePath: "slides/talk.astro",
      format: "astro",
      metadata: {},
    });
  });
});

test("resolveDeckFile rejects a missing deck argument", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckFile(projectRoot, undefined)).rejects.toThrow(
      /Missing Slida deck file/,
    );
  });
});

test("resolveDeckFile rejects a missing deck file", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckFile(projectRoot, "slides/missing.astro")).rejects.toThrow(
      /Slida deck file not found/,
    );
  });
});

test("resolveDeckFile rejects deck files outside the project root", async () => {
  await withProjectRoot(async (projectRoot) => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "slida-outside-"));
    try {
      const outsideDeck = join(outsideRoot, "talk.astro");
      await writeFile(outsideDeck, "---\n---\n");

      await expect(resolveDeckFile(projectRoot, outsideDeck)).rejects.toThrow(
        /must be inside the project root/,
      );
    } finally {
      await rm(outsideRoot, { force: true, recursive: true });
    }
  });
});
