import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import {
  BUILTIN_DECKUP_THEME_PACKAGES,
  BUILTIN_DECKUP_THEMES,
  resolveDeckupThemeLayouts,
  resolveThemePackageRootForTests,
} from "../src/theme.ts";

async function readCorePackageJson() {
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw) as { dependencies?: Record<string, string> };
}

test("every BUILTIN_DECKUP_THEME_PACKAGES value is a Core dependency", async () => {
  const corePackageJson = await readCorePackageJson();
  const dependencies = corePackageJson.dependencies ?? {};

  for (const packageName of Object.values(BUILTIN_DECKUP_THEME_PACKAGES)) {
    expect(Object.hasOwn(dependencies, packageName)).toBe(true);
  }
});

test("every built-in theme resolves its ./package.json export via package exports", async () => {
  for (const themeName of BUILTIN_DECKUP_THEMES) {
    const theme = await resolveDeckupThemeLayouts("/tmp/deckup-nonexistent-project", themeName);

    expect(theme.source).toBe("builtin");
    expect(theme.packageName).toBe(BUILTIN_DECKUP_THEME_PACKAGES[themeName]);
    expect(theme.filePath.endsWith("package.json")).toBe(true);
  }
});

test("forced built-in resolution failure throws the existing contextual error and retains cause", () => {
  const injectedCause = new Error("injected built-in theme resolution failure");

  let caught: unknown;
  try {
    resolveThemePackageRootForTests("/tmp/deckup-nonexistent-project", "default", () => {
      throw injectedCause;
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toMatch(
    /Unable to resolve Deckup theme "default" package metadata from \/tmp\/deckup-nonexistent-project\. Built-in themes: default, minimal, google-basic, apple-basic\. For npm themes, install the package and export \.\/package\.json plus Astro layout components from layouts\/\*\.astro\./,
  );
  expect((caught as Error).cause).toBe(injectedCause);
});
