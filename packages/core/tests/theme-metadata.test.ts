import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

import {
  applyDeckupThemeMetadata,
  parseDeckupThemePackageJson,
  readDeckupThemePackageJson,
} from "../src/theme-metadata.ts";
import type { DeckupResolvedThemeLayout } from "../src/types.ts";

const packageJsonPath = "/theme/package.json";
const context = 'Deckup theme "fixture"';

function layout(id: string): DeckupResolvedThemeLayout {
  return {
    id,
    filePath: `/theme/layouts/${id}.astro`,
    importPath: `/@fs/theme/layouts/${id}.astro`,
    hasDefaultSlot: true,
    slotNames: [],
  };
}

test("parses, trims, and preserves extensible theme metadata", () => {
  const packageJson = parseDeckupThemePackageJson(
    {
      name: "@acme/theme",
      description: "  Theme description.  ",
      deckup: {
        layouts: {
          cover: { description: "  Cover description.  ", future: true },
        },
        future: true,
      },
      future: true,
    },
    context,
    packageJsonPath,
  );

  expect(packageJson).toMatchObject({
    name: "@acme/theme",
    description: "Theme description.",
    deckup: {
      layouts: {
        cover: { description: "Cover description.", future: true },
      },
      future: true,
    },
    future: true,
  });
});

test("attaches descriptions only to discovered layouts", () => {
  const cover = layout("cover");
  const page = layout("page");
  const packageJson = parseDeckupThemePackageJson(
    {
      description: "Theme description.",
      deckup: { layouts: { cover: { description: "Cover description." } } },
    },
    context,
    packageJsonPath,
  );

  const metadata = applyDeckupThemeMetadata("fixture", packageJsonPath, packageJson, [cover, page]);

  expect(metadata.description).toBe("Theme description.");
  expect(metadata.layouts[0]).toEqual({ ...cover, description: "Cover description." });
  expect(metadata.layouts[1]).toBe(page);
});

test("keeps missing descriptions optional", () => {
  const cover = layout("cover");
  const packageJson = parseDeckupThemePackageJson(
    { name: "@acme/theme" },
    context,
    packageJsonPath,
  );

  const metadata = applyDeckupThemeMetadata("fixture", packageJsonPath, packageJson, [cover]);

  expect(metadata).toEqual({ layouts: [cover] });
  expect(metadata.layouts[0]).toBe(cover);
});

const invalidMetadataCases: Array<[string, unknown, RegExp]> = [
  ["package object", null, /package metadata must be an object/],
  ["theme description type", { description: 42 }, /field "description" must be a non-empty string/],
  [
    "empty theme description",
    { description: "   " },
    /field "description" must be a non-empty string/,
  ],
  ["deckup object", { deckup: "invalid" }, /field "deckup" must be an object/],
  ["layouts object", { deckup: { layouts: [] } }, /field "deckup\.layouts" must be an object/],
  [
    "layout entry object",
    { deckup: { layouts: { cover: null } } },
    /field "deckup\.layouts\.cover" must be an object/,
  ],
  [
    "description layout entry object",
    { deckup: { layouts: { description: null } } },
    /field "deckup\.layouts\.description" must be an object/,
  ],
  [
    "layout description type",
    { deckup: { layouts: { cover: { description: false } } } },
    /field "deckup\.layouts\.cover\.description" must be a non-empty string/,
  ],
  [
    "empty layout description",
    { deckup: { layouts: { cover: { description: "  " } } } },
    /field "deckup\.layouts\.cover\.description" must be a non-empty string/,
  ],
];

test.each(invalidMetadataCases)("rejects invalid %s with context", (_name, value, message) => {
  expect(() => parseDeckupThemePackageJson(value, context, packageJsonPath)).toThrow(message);
  expect(() => parseDeckupThemePackageJson(value, context, packageJsonPath)).toThrow(
    packageJsonPath,
  );
});

test("rejects an own __proto__ layout key before Zod record normalization", () => {
  const packageJson = JSON.parse(
    '{"deckup":{"layouts":{"__proto__":{"description":"Hidden layout."}}}}',
  );

  expect(() => parseDeckupThemePackageJson(packageJson, context, packageJsonPath)).toThrow(
    /deckup\.layouts\.__proto__.*must not use "__proto__" as a layout id/,
  );
});

test("rejects metadata for a layout that discovery did not return", () => {
  const packageJson = parseDeckupThemePackageJson(
    { deckup: { layouts: { missing: { description: "Missing layout." } } } },
    context,
    packageJsonPath,
  );

  expect(() =>
    applyDeckupThemeMetadata("fixture", packageJsonPath, packageJson, [layout("cover")]),
  ).toThrow(
    /Deckup theme "fixture".*deckup\.layouts\.missing.*unknown layout "missing".*Discovered layouts: cover/,
  );
});

test("reads package JSON and preserves filesystem and parse errors as causes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deckup-theme-metadata-"));
  try {
    const missingPath = join(directory, "missing.json");
    let missingError: unknown;
    try {
      await readDeckupThemePackageJson(missingPath, context);
    } catch (error) {
      missingError = error;
    }
    expect(missingError).toBeInstanceOf(Error);
    expect((missingError as Error).cause).toBeInstanceOf(Error);

    const malformedPath = join(directory, "malformed.json");
    await writeFile(malformedPath, "{ invalid");
    let parseError: unknown;
    try {
      await readDeckupThemePackageJson(malformedPath, context);
    } catch (error) {
      parseError = error;
    }
    expect(parseError).toBeInstanceOf(Error);
    expect((parseError as Error).cause).toBeInstanceOf(SyntaxError);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
