import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

import {
  SUPPORTED_DECK_EXTENSIONS,
  createDeckRegistry,
  createSingleDeckRegistry,
  inferDeckFormat,
  normalizeDeckupBasePath,
  resolveDeckFile,
  resolveDeckFilesFromGlob,
  resolveDeckRegistry,
} from "../src/deck.ts";

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-core-deck-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function writeDeck(projectRoot: string, path: string, source = "---\n---\n") {
  const parts = path.split("/");
  await mkdir(join(projectRoot, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(join(projectRoot, ...parts), source);
}

test("SUPPORTED_DECK_EXTENSIONS documents Astro and MDX deck support", () => {
  expect(SUPPORTED_DECK_EXTENSIONS).toEqual([".astro", ".mdx"]);
});

test("inferDeckFormat accepts Astro and MDX deck files", () => {
  expect(inferDeckFormat("slides/talk.astro")).toBe("astro");
  expect(inferDeckFormat("slides/talk.mdx")).toBe("mdx");
});

test("inferDeckFormat rejects unsupported deck extensions", () => {
  expect(() => inferDeckFormat("slides/talk.md")).toThrow(/Unsupported Deckup deck file extension/);
});

test("resolveDeckFile resolves a project-relative deck file", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "slides/talk.astro");

    await expect(resolveDeckFile(projectRoot, "slides/talk.astro")).resolves.toEqual({
      filePath: join(projectRoot, "slides", "talk.astro"),
      projectRelativePath: "slides/talk.astro",
      format: "astro",
      metadata: {},
    });
  });
});

test("resolveDeckFile includes static MDX deck metadata", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(
      projectRoot,
      "slides/talk.mdx",
      `---
theme: minimal
---

# Talk
`,
    );

    await expect(resolveDeckFile(projectRoot, "slides/talk.mdx")).resolves.toMatchObject({
      projectRelativePath: "slides/talk.mdx",
      format: "mdx",
      metadata: { theme: "minimal" },
    });
  });
});

test("resolveDeckFile includes static Astro deck metadata", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(
      projectRoot,
      "slides/talk.astro",
      `---
import Page from "@deckup/astro/page";
const theme = "google-basic";
---

<Page />
`,
    );

    await expect(resolveDeckFile(projectRoot, "slides/talk.astro")).resolves.toMatchObject({
      projectRelativePath: "slides/talk.astro",
      format: "astro",
      metadata: { theme: "google-basic" },
    });
  });
});

test("resolveDeckFile rejects a missing deck argument", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckFile(projectRoot, undefined)).rejects.toThrow(
      /Missing Deckup deck file/,
    );
  });
});

test("resolveDeckFile rejects a missing deck file", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(resolveDeckFile(projectRoot, "slides/missing.astro")).rejects.toThrow(
      /Deckup deck file not found/,
    );
  });
});

test("resolveDeckFile rejects deck files outside the project root", async () => {
  await withProjectRoot(async (projectRoot) => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "deckup-outside-"));
    try {
      await writeFile(join(outsideRoot, "talk.astro"), "---\n---\n");
      await expect(resolveDeckFile(projectRoot, join(outsideRoot, "talk.astro"))).rejects.toThrow(
        /must be inside the project root/,
      );
    } finally {
      await rm(outsideRoot, { force: true, recursive: true });
    }
  });
});

test("normalizeDeckupBasePath normalizes route bases", () => {
  expect(normalizeDeckupBasePath("slides")).toBe("/slides");
  expect(normalizeDeckupBasePath("/slides/")).toBe("/slides");
  expect(normalizeDeckupBasePath("/")).toBe("/");
});

test("resolveDeckFilesFromGlob resolves sorted route-aware decks", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "src/slides/intro.astro");
    await writeDeck(projectRoot, "src/slides/nested/guide.mdx");

    await expect(
      resolveDeckFilesFromGlob(projectRoot, "src/slides/**/*.{astro,mdx}", "/decks"),
    ).resolves.toEqual([
      expect.objectContaining({
        projectRelativePath: "src/slides/intro.astro",
        format: "astro",
        slug: "intro",
        routePath: "/decks/intro",
        routeId: "decks_intro",
        virtualDeckModuleId: "virtual:deckup/decks/decks_intro",
        virtualRouteModuleId: "virtual:deckup/routes/decks_intro.astro",
      }),
      expect.objectContaining({
        projectRelativePath: "src/slides/nested/guide.mdx",
        format: "mdx",
        slug: "nested/guide",
        routePath: "/decks/nested/guide",
        routeId: "decks_nested_guide",
      }),
    ]);
  });
});

test("resolveDeckFilesFromGlob uses each matching glob base for slug derivation", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "src/talks/intro.astro");
    await writeDeck(projectRoot, "docs/decks/guide.mdx");

    const decks = await resolveDeckFilesFromGlob(
      projectRoot,
      ["src/talks/*.astro", "docs/decks/*.mdx"],
      "/slides",
    );

    expect(decks).toEqual([
      expect.objectContaining({
        projectRelativePath: "docs/decks/guide.mdx",
        sourceGlob: "docs/decks/*.mdx",
        globBase: "docs/decks",
        slug: "guide",
        routePath: "/slides/guide",
      }),
      expect.objectContaining({
        projectRelativePath: "src/talks/intro.astro",
        sourceGlob: "src/talks/*.astro",
        globBase: "src/talks",
        slug: "intro",
        routePath: "/slides/intro",
      }),
    ]);
  });
});

test("resolveDeckRegistry exposes match helpers for selected files and routes", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "src/slides/intro.astro");
    const registry = await resolveDeckRegistry(projectRoot, "src/slides/*.astro", "/slides");
    const [deck] = registry.decks;

    expect(registry.getByRoutePath("/slides/intro")).toBe(deck);
    expect(registry.getByRouteId("slides_intro")).toBe(deck);
    expect(registry.matchId(deck.filePath)).toBe(deck);
    expect(registry.matchId(`/src/slides/intro.astro?astro&type=script`)).toBe(deck);
    expect(registry.matchId("virtual:deckup/decks/slides_intro")).toBe(deck);
  });
});

test("createSingleDeckRegistry exposes a root route for one CLI deck", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "slides/talk.astro");
    const deck = await resolveDeckFile(projectRoot, "slides/talk.astro");
    const registry = createSingleDeckRegistry(projectRoot, deck);
    const [routeDeck] = registry.decks;

    expect(registry.base).toBe("/");
    expect(routeDeck).toMatchObject({
      ...deck,
      sourceGlob: "slides/talk.astro",
      globBase: "slides",
      slug: "",
      routePath: "/",
      routeId: "index",
      virtualDeckModuleId: "virtual:deckup/decks/index",
      virtualRouteModuleId: "virtual:deckup/routes/index.astro",
    });
    expect(registry.getByRoutePath("/")).toBe(routeDeck);
    expect(registry.getByRouteId("index")).toBe(routeDeck);
    expect(registry.matchId(deck.filePath)).toBe(routeDeck);
    expect(registry.matchId("virtual:deckup/routes/index.astro")).toBe(routeDeck);
  });
});

test("registry MDX matching follows vfile path and history", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "src/slides/guide.mdx");
    const registry = await resolveDeckRegistry(projectRoot, "src/slides/*.mdx", "/slides");
    const [deck] = registry.decks;

    expect(registry.matchMdxFile({ path: join(projectRoot, "src", "slides", "guide.mdx") })).toBe(
      deck,
    );
    expect(
      registry.matchMdxFile({ history: [join(projectRoot, "src", "slides", "guide.mdx")] }),
    ).toBe(deck);
    expect(
      registry.matchMdxFile({ path: join(projectRoot, "src", "content", "docs.mdx") }),
    ).toBeUndefined();
  });
});

test("createDeckRegistry rejects route collisions", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeDeck(projectRoot, "src/slides/intro.astro");
    await writeDeck(projectRoot, "src/slides/intro.mdx");
    const decks = await resolveDeckFilesFromGlob(
      projectRoot,
      "src/slides/*.{astro,mdx}",
      "/slides",
    );

    expect(() => createDeckRegistry(projectRoot, "/slides", decks)).toThrow(/route collision/);
  });
});
