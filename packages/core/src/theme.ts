import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseNpmThemeSource, resolveCachedNpmThemePackage } from "./npm-theme.ts";
import { discoverThemeLayouts } from "./theme-layouts.ts";
import { uniqueStrings } from "./utils.ts";

export const DEFAULT_DECKUP_THEME = "default";
export const BUILTIN_DECKUP_THEME_PACKAGES = {
  default: "@deckup/theme-default",
  minimal: "@deckup/theme-minimal",
  "google-basic": "@deckup/theme-google-basic",
  "apple-basic": "@deckup/theme-apple-basic",
} as const;
export const BUILTIN_DECKUP_THEMES = Object.keys(BUILTIN_DECKUP_THEME_PACKAGES) as Array<
  keyof typeof BUILTIN_DECKUP_THEME_PACKAGES
>;

const coreRequire = createRequire(import.meta.url);
const coreModuleDir = dirname(fileURLToPath(import.meta.url));

type DeckupBuiltinTheme = (typeof BUILTIN_DECKUP_THEMES)[number];

type ResolvedThemePackage = {
  filePath: string;
  packageJsonPath?: string;
  packageName: string;
  packageRoot?: string;
  source: "builtin" | "package";
};

function isBuiltinThemeName(themeName: string): themeName is DeckupBuiltinTheme {
  return Object.hasOwn(BUILTIN_DECKUP_THEME_PACKAGES, themeName);
}

function normalizeThemeName(theme: unknown) {
  const themeName = theme ?? DEFAULT_DECKUP_THEME;

  if (typeof themeName !== "string") {
    throw new TypeError("Deckup theme must be a string when provided.");
  }

  const trimmedThemeName = themeName.trim();
  if (trimmedThemeName.length === 0) {
    throw new TypeError("Deckup theme must not be an empty string.");
  }

  return trimmedThemeName;
}

function createThemeResolver(projectRoot: string, themeName: string) {
  const isBuiltin = isBuiltinThemeName(themeName);
  const packageName = isBuiltin ? BUILTIN_DECKUP_THEME_PACKAGES[themeName] : themeName;
  const resolver = isBuiltin ? coreRequire : createRequire(join(projectRoot, "package.json"));
  return { isBuiltin, packageName, resolver };
}

function resolveThemePackageRoot(projectRoot: string, themeName: string): ResolvedThemePackage {
  const { isBuiltin, packageName, resolver } = createThemeResolver(projectRoot, themeName);

  try {
    const packageJsonPath = resolver.resolve(`${packageName}/package.json`);
    return {
      filePath: packageJsonPath,
      packageJsonPath,
      packageName,
      packageRoot: dirname(packageJsonPath),
      source: isBuiltin ? "builtin" : "package",
    } as const;
  } catch (error) {
    if (isBuiltin) {
      const workspacePackageJsonPath = join(
        coreModuleDir,
        "..",
        "..",
        packageName.replace("@deckup/theme-", "theme-"),
        "package.json",
      );
      return {
        filePath: workspacePackageJsonPath,
        packageJsonPath: workspacePackageJsonPath,
        packageName,
        packageRoot: dirname(workspacePackageJsonPath),
        source: "builtin",
      };
    }

    throw new Error(
      `Unable to resolve Deckup theme ${JSON.stringify(themeName)} package metadata from ${projectRoot}. Built-in themes: ${BUILTIN_DECKUP_THEMES.join(", ")}. For npm themes, install the package and export ./package.json plus Astro layout components from layouts/*.astro.`,
      { cause: error },
    );
  }
}

export async function resolveDeckupThemeLayouts(projectRoot: string, theme: unknown) {
  const name = normalizeThemeName(theme);
  const npmSource = parseNpmThemeSource(name);
  const resolvedTheme = npmSource
    ? await resolveCachedNpmThemePackage(npmSource)
    : resolveThemePackageRoot(projectRoot, name);
  const packageRoot = resolvedTheme.packageRoot ?? dirname(resolvedTheme.filePath);
  const layoutsDir = join(packageRoot, "layouts");
  const layouts = await discoverThemeLayouts(name, layoutsDir);

  return {
    name,
    filePath: resolvedTheme.filePath,
    packageName: resolvedTheme.packageName,
    packageRoot,
    layoutsDir,
    layouts,
    slotNames: uniqueStrings(layouts.flatMap((layout) => layout.slotNames)).sort(),
    source: resolvedTheme.source,
  };
}
