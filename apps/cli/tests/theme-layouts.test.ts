import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

import { createThemeLayoutDiscoveryCache, discoverThemeLayouts } from "../src/theme-layouts.ts";

async function withLayoutsDir(run: (layoutsDir: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-layouts-"));
  try {
    const layoutsDir = join(projectRoot, "layouts");
    await mkdir(layoutsDir, { recursive: true });
    await run(layoutsDir);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function writeLayout(layoutsDir: string, fileName: string, source: string) {
  const filePath = join(layoutsDir, fileName);
  await writeFile(filePath, source);
  return filePath;
}

test("discoverThemeLayouts returns sorted layouts with slot metadata", async () => {
  await withLayoutsDir(async (layoutsDir) => {
    await writeLayout(layoutsDir, "two-column.astro", '<slot name="left" /><slot name="right" />');
    await writeLayout(layoutsDir, "cover.astro", "<slot />");

    const layouts = await discoverThemeLayouts("fixture", layoutsDir);

    expect(layouts.map((layout) => layout.id)).toEqual(["cover", "two-column"]);
    expect(layouts[0]).toMatchObject({ slotNames: [] });
    expect(layouts[0].importPath).toMatch(/^\/@fs\//);
    expect(layouts[1].slotNames).toEqual(["left", "right"]);
  });
});

test("discoverThemeLayouts ignores private and non-Astro files", async () => {
  await withLayoutsDir(async (layoutsDir) => {
    await writeLayout(layoutsDir, "cover.astro", "<slot />");
    await writeLayout(layoutsDir, "_partial.astro", '<slot name="ignored" />');
    await writeLayout(layoutsDir, "notes.txt", "ignored");

    const layouts = await discoverThemeLayouts("fixture", layoutsDir);

    expect(layouts.map((layout) => layout.id)).toEqual(["cover"]);
  });
});

test("discoverThemeLayouts rejects empty layout directories", async () => {
  await withLayoutsDir(async (layoutsDir) => {
    await expect(discoverThemeLayouts("fixture", layoutsDir)).rejects.toThrow(
      /must include at least one layouts\/\*\.astro/,
    );
  });
});

test("discoverThemeLayouts rejects missing layout directories", async () => {
  await expect(
    discoverThemeLayouts("fixture", join(tmpdir(), "slida-missing-layouts")),
  ).rejects.toThrow(/must include a readable layouts directory/);
});

test("createThemeLayoutDiscoveryCache returns the same array for cache hits", async () => {
  await withLayoutsDir(async (layoutsDir) => {
    await writeLayout(layoutsDir, "cover.astro", "<slot />");
    const discoverCached = createThemeLayoutDiscoveryCache();

    const first = await discoverCached("fixture", layoutsDir);
    const second = await discoverCached("fixture", layoutsDir);

    expect(second).toBe(first);
  });
});

test("createThemeLayoutDiscoveryCache invalidates after file content changes", async () => {
  await withLayoutsDir(async (layoutsDir) => {
    const filePath = await writeLayout(layoutsDir, "cover.astro", "<slot />");
    const discoverCached = createThemeLayoutDiscoveryCache();
    const first = await discoverCached("fixture", layoutsDir);

    await writeFile(filePath, '<slot name="after" />');
    const later = new Date(Date.now() + 2_000);
    await utimes(filePath, later, later);
    const second = await discoverCached("fixture", layoutsDir);

    expect(second).not.toBe(first);
    expect(second[0].slotNames).toEqual(["after"]);
  });
});

test("createThemeLayoutDiscoveryCache invalidates after file addition", async () => {
  await withLayoutsDir(async (layoutsDir) => {
    await writeLayout(layoutsDir, "cover.astro", "<slot />");
    const discoverCached = createThemeLayoutDiscoveryCache();
    const first = await discoverCached("fixture", layoutsDir);

    await writeLayout(layoutsDir, "two-column.astro", '<slot name="left" />');
    const second = await discoverCached("fixture", layoutsDir);

    expect(second).not.toBe(first);
    expect(second.map((layout) => layout.id)).toEqual(["cover", "two-column"]);
  });
});
