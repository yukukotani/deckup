import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { expect, test } from "vite-plus/test";

import {
  assertSafePngOutputDirectory,
  formatPngSlideFileName,
  normalizePngOutputDir,
  parsePngSlideSelection,
  resolvePngFiles,
} from "../src/png.ts";

type PngProjectFixture = {
  projectRoot: string;
  deckFile: string;
  stagingDir: string;
};

async function withPngProject(run: (fixture: PngProjectFixture) => Promise<void>) {
  const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "deckup-png-")));
  const deckFile = join(projectRoot, "slides", "deck.astro");
  const stagingDir = join(projectRoot, "dist");
  try {
    await mkdir(join(projectRoot, "slides"), { recursive: true });
    await writeFile(deckFile, "<Page />\n");
    await run({ projectRoot, deckFile, stagingDir });
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

function safetyOptions(fixture: PngProjectFixture, outputDir: string) {
  return { ...fixture, outputDir };
}

test("parsePngSlideSelection selects all slides when omitted", () => {
  expect(parsePngSlideSelection(undefined, 4)).toEqual([1, 2, 3, 4]);
});

test("parsePngSlideSelection de-duplicates and sorts numbers and inclusive ranges", () => {
  expect(parsePngSlideSelection("3, 1, 3-4", 5)).toEqual([1, 3, 4]);
});

test("parsePngSlideSelection rejects malformed, non-positive, reversed, and unsafe values", () => {
  const invalidSelections = [
    "",
    " ",
    "1,,2",
    "-1",
    "0",
    "1-",
    "1-2-3",
    "3-1",
    "1.5",
    "NaN",
    "9007199254740992",
  ];
  for (const selection of invalidSelections) {
    expect(() => parsePngSlideSelection(selection, 5)).toThrow(/Deckup PNG slide/);
  }
});

test("parsePngSlideSelection rejects any out-of-range segment", () => {
  expect(() => parsePngSlideSelection("1,6", 5)).toThrow(/out of range/);
  expect(() => parsePngSlideSelection("4-6", 5)).toThrow(/out of range/);
});

test("PNG output helpers use the deck basename and zero-padded one-based names", () => {
  const projectRoot = "/tmp/deckup-project";
  const deck = {
    filePath: join(projectRoot, "slides", "talk.astro"),
    projectRelativePath: "slides/talk.astro",
    format: "astro" as const,
  };
  expect(normalizePngOutputDir(projectRoot, deck)).toBe(join(projectRoot, "talk"));
  expect(normalizePngOutputDir(projectRoot, deck, "/tmp/rendered")).toBe("/tmp/rendered");
  expect(formatPngSlideFileName(1)).toBe("slide-001.png");
  expect(formatPngSlideFileName(1000)).toBe("slide-1000.png");
  expect(resolvePngFiles("/tmp/rendered", [1, 3])).toEqual([
    join("/tmp/rendered", "slide-001.png"),
    join("/tmp/rendered", "slide-003.png"),
  ]);
});

test("assertSafePngOutputDirectory allows safe project and external directories", async () => {
  await withPngProject(async (fixture) => {
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, join(fixture.projectRoot, "rendered"))),
    ).resolves.toBeUndefined();
    const externalOutput = await mkdtemp(join(tmpdir(), "deckup-png-output-"));
    try {
      await expect(
        assertSafePngOutputDirectory(safetyOptions(fixture, externalOutput)),
      ).resolves.toBeUndefined();
    } finally {
      await rm(externalOutput, { force: true, recursive: true });
    }
  });
});

test("assertSafePngOutputDirectory rejects filesystem and project roots without deleting files", async () => {
  await withPngProject(async (fixture) => {
    const sentinel = join(fixture.projectRoot, "sentinel.txt");
    await writeFile(sentinel, "keep");
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, parse(fixture.projectRoot).root)),
    ).rejects.toThrow(/filesystem root/);
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, fixture.projectRoot)),
    ).rejects.toThrow(/project root/);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
  });
});

test("assertSafePngOutputDirectory rejects the source deck and its ancestors", async () => {
  await withPngProject(async (fixture) => {
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, fixture.deckFile)),
    ).rejects.toThrow(/contains the source deck/);
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, join(fixture.projectRoot, "slides"))),
    ).rejects.toThrow(/contains the source deck/);
  });
});

test("assertSafePngOutputDirectory rejects either direction of staging overlap", async () => {
  await withPngProject(async (fixture) => {
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, fixture.stagingDir)),
    ).rejects.toThrow(/staging directory/);
    await expect(
      assertSafePngOutputDirectory(safetyOptions(fixture, join(fixture.stagingDir, "images"))),
    ).rejects.toThrow(/staging directory/);
    const parentOutput = join(fixture.projectRoot, "build");
    await expect(
      assertSafePngOutputDirectory({
        ...fixture,
        stagingDir: join(parentOutput, "static"),
        outputDir: parentOutput,
      }),
    ).rejects.toThrow(/staging directory/);
  });
});

test("assertSafePngOutputDirectory follows symlinks and rejects their effective dangerous target", async () => {
  await withPngProject(async (fixture) => {
    const externalRoot = await mkdtemp(join(tmpdir(), "deckup-png-symlink-"));
    try {
      const projectLink = join(externalRoot, "project-link");
      const slidesLink = join(externalRoot, "slides-link");
      await symlink(fixture.projectRoot, projectLink, "dir");
      await symlink(join(fixture.projectRoot, "slides"), slidesLink, "dir");
      await expect(
        assertSafePngOutputDirectory(safetyOptions(fixture, projectLink)),
      ).rejects.toThrow(/project root/);
      await expect(
        assertSafePngOutputDirectory(safetyOptions(fixture, slidesLink)),
      ).rejects.toThrow(/contains the source deck/);
    } finally {
      await rm(externalRoot, { force: true, recursive: true });
    }
  });
});
