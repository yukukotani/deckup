import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, sep } from "node:path";

import type { SlidaResolvedTheme } from "./types.ts";

export const DEFAULT_SLIDA_THEME = "default";
export const BUILTIN_SLIDA_THEME_PACKAGES = {
  default: "@slida/theme-default",
  minimal: "@slida/theme-minimal",
  bold: "@slida/theme-bold",
} as const;
export const BUILTIN_SLIDA_THEMES = Object.keys(BUILTIN_SLIDA_THEME_PACKAGES) as Array<
  keyof typeof BUILTIN_SLIDA_THEME_PACKAGES
>;

const cliRequire = createRequire(import.meta.url);

type SlidaBuiltinTheme = (typeof BUILTIN_SLIDA_THEMES)[number];

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function toViteFsImportPath(filePath: string) {
  return `/@fs/${normalizePath(filePath)}`;
}

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

function resolveThemePackage(projectRoot: string, themeName: string) {
  const isBuiltin = isBuiltinThemeName(themeName);
  const packageName = isBuiltin ? BUILTIN_SLIDA_THEME_PACKAGES[themeName] : themeName;
  const resolver = isBuiltin ? cliRequire : createRequire(join(projectRoot, "package.json"));

  try {
    return {
      filePath: resolver.resolve(packageName),
      packageName,
      source: isBuiltin ? "builtin" : "package",
    } as const;
  } catch (error) {
    throw new Error(
      `Unable to resolve Slida theme ${JSON.stringify(themeName)} from ${projectRoot}. Built-in themes: ${BUILTIN_SLIDA_THEMES.join(", ")}. For npm themes, install the package and export CSS from its package root.`,
      { cause: error },
    );
  }
}

async function assertReadableCssTheme(themeName: string, filePath: string) {
  if (extname(filePath) !== ".css") {
    throw new Error(
      `Slida theme ${JSON.stringify(themeName)} must resolve to a CSS file. Resolved path: ${filePath}`,
    );
  }

  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    throw new Error(`Slida theme ${JSON.stringify(themeName)} CSS is not readable: ${filePath}`, {
      cause: error,
    });
  }
}

export async function resolveSlidaTheme(
  projectRoot: string,
  theme: unknown = DEFAULT_SLIDA_THEME,
): Promise<SlidaResolvedTheme> {
  const name = normalizeThemeName(theme);
  const resolvedTheme = resolveThemePackage(projectRoot, name);
  await assertReadableCssTheme(name, resolvedTheme.filePath);

  return {
    name,
    importPath: toViteFsImportPath(resolvedTheme.filePath),
    filePath: resolvedTheme.filePath,
    source: resolvedTheme.source,
  };
}
