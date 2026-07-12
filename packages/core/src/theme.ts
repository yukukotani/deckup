import { createRequire } from "node:module";
import { dirname, join } from "node:path";

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

type BuiltinThemePackageJsonResolver = (packageName: string) => string;

function resolveBuiltinThemePackageJsonPath(packageName: string) {
  return coreRequire.resolve(`${packageName}/package.json`);
}

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

function createThemeResolver(themeName: string) {
  const isBuiltin = isBuiltinThemeName(themeName);
  const packageName = isBuiltin ? BUILTIN_DECKUP_THEME_PACKAGES[themeName] : themeName;
  return { isBuiltin, packageName };
}

function resolveThemePackageRoot(
  projectRoot: string,
  themeName: string,
  builtinThemePackageJsonResolver: BuiltinThemePackageJsonResolver = resolveBuiltinThemePackageJsonPath,
): ResolvedThemePackage {
  const { isBuiltin, packageName } = createThemeResolver(themeName);
  const resolvePackageJsonPath = isBuiltin
    ? () => builtinThemePackageJsonResolver(packageName)
    : () => createRequire(join(projectRoot, "package.json")).resolve(`${packageName}/package.json`);

  try {
    const packageJsonPath = resolvePackageJsonPath();
    return {
      filePath: packageJsonPath,
      packageJsonPath,
      packageName,
      packageRoot: dirname(packageJsonPath),
      source: isBuiltin ? "builtin" : "package",
    } as const;
  } catch (error) {
    throw new Error(
      `Unable to resolve Deckup theme ${JSON.stringify(themeName)} package metadata from ${projectRoot}. Built-in themes: ${BUILTIN_DECKUP_THEMES.join(", ")}. For npm themes, install the package and export ./package.json plus Astro layout components from layouts/*.astro.`,
      { cause: error },
    );
  }
}

// Exported for tests only; not part of the public package surface (index.ts).
// Lets tests force built-in theme resolution failures to exercise the contextual error path
// via per-call resolver injection, with no mutable module state involved.
export { resolveThemePackageRoot as resolveThemePackageRootForTests };

type DeckupThemeResolveOptions = {
  sourceMode?: "all" | "installed";
};

export async function resolveDeckupThemeLayouts(
  projectRoot: string,
  theme: unknown,
  options: DeckupThemeResolveOptions = {},
) {
  const name = normalizeThemeName(theme);
  const npmSource = parseNpmThemeSource(name);
  if (npmSource && options.sourceMode === "installed") {
    throw new Error(
      `Deckup theme ${JSON.stringify(name)} uses an npm: source, but this operation only supports built-in themes and installed packages. Install ${JSON.stringify(npmSource.packageName)} in the project and use its package name instead.`,
    );
  }
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
