import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { discoverThemeLayouts } from "./theme-layouts.ts";
import { uniqueStrings } from "./utils.ts";

export const DEFAULT_SLIDA_THEME = "default";
export const BUILTIN_SLIDA_THEME_PACKAGES = {
  default: "@slida/theme-default",
  minimal: "@slida/theme-minimal",
  bold: "@slida/theme-bold",
  "google-basic": "@slida/theme-google-basic",
  "apple-basic": "@slida/theme-apple-basic",
} as const;
export const BUILTIN_SLIDA_THEMES = Object.keys(BUILTIN_SLIDA_THEME_PACKAGES) as Array<
  keyof typeof BUILTIN_SLIDA_THEME_PACKAGES
>;

const cliRequire = createRequire(import.meta.url);

type SlidaBuiltinTheme = (typeof BUILTIN_SLIDA_THEMES)[number];

type ResolvedThemePackage = {
  filePath: string;
  packageJsonPath?: string;
  packageName: string;
  packageRoot?: string;
  source: "builtin" | "package";
};

function isBuiltinThemeName(themeName: string): themeName is SlidaBuiltinTheme {
  return Object.hasOwn(BUILTIN_SLIDA_THEME_PACKAGES, themeName);
}

function normalizeThemeName(theme: unknown) {
  const themeName = theme ?? DEFAULT_SLIDA_THEME;

  if (typeof themeName !== "string") {
    throw new TypeError("Slida theme must be a string when provided.");
  }

  const trimmedThemeName = themeName.trim();
  if (trimmedThemeName.length === 0) {
    throw new TypeError("Slida theme must not be an empty string.");
  }

  return trimmedThemeName;
}

function createThemeResolver(projectRoot: string, themeName: string) {
  const isBuiltin = isBuiltinThemeName(themeName);
  const packageName = isBuiltin ? BUILTIN_SLIDA_THEME_PACKAGES[themeName] : themeName;
  const resolver = isBuiltin ? cliRequire : createRequire(join(projectRoot, "package.json"));
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
    throw new Error(
      `Unable to resolve Slida theme ${JSON.stringify(themeName)} package metadata from ${projectRoot}. Built-in themes: ${BUILTIN_SLIDA_THEMES.join(", ")}. For npm themes, install the package and export ./package.json plus Astro layout components from layouts/*.astro.`,
      { cause: error },
    );
  }
}

export async function resolveSlidaThemeLayouts(projectRoot: string, theme: unknown) {
  const name = normalizeThemeName(theme);
  const resolvedTheme = resolveThemePackageRoot(projectRoot, name);
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
