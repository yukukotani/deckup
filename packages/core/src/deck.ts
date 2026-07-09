import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import { glob } from "tinyglobby";

import { analyzeMdxDeckMetadata } from "./slida-mdx-pages.ts";
import { analyzeAstroDeckMetadata } from "./slida-vite-plugins.ts";
import type {
  SlidaDeckFormat,
  SlidaDeckMetadata,
  SlidaDeckRegistry,
  SlidaResolvedDeck,
  SlidaResolvedDeckRoute,
} from "./types.ts";
import { normalizeIdPath, normalizePath } from "./utils.ts";

export const SUPPORTED_DECK_EXTENSIONS = [".astro", ".mdx"] as const;
export const VIRTUAL_SLIDA_DECK_PREFIX = "virtual:slida/decks/";
export const VIRTUAL_SLIDA_ROUTE_PREFIX = "virtual:slida/routes/";

function toProjectPath(path: string) {
  return normalizePath(path);
}

async function readDeckMetadata(
  filePath: string,
  projectRelativePath: string,
  format: SlidaDeckFormat,
): Promise<SlidaDeckMetadata> {
  const source = await readFile(filePath, "utf8");
  return format === "mdx"
    ? analyzeMdxDeckMetadata(source, projectRelativePath)
    : analyzeAstroDeckMetadata(source, projectRelativePath);
}

function isInsideProject(projectRoot: string, filePath: string) {
  const relativePath = relative(projectRoot, filePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function stripQuery(id: string) {
  return id.split("?", 1)[0];
}

function ensureLeadingSlash(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function trimSlashes(path: string) {
  return path.replace(/^\/+|\/+$/g, "");
}

export function normalizeSlidaBasePath(base = "/slides") {
  const trimmed = trimSlashes(normalizeIdPath(base));
  return trimmed.length === 0 ? "/" : `/${trimmed}`;
}

function joinRoutePath(base: string, slug: string) {
  const normalizedBase = normalizeSlidaBasePath(base);
  const normalizedSlug = trimSlashes(slug);
  if (normalizedBase === "/") return `/${normalizedSlug}`;
  return normalizedSlug.length === 0 ? normalizedBase : `${normalizedBase}/${normalizedSlug}`;
}

function stripDeckExtension(path: string) {
  const extension = extname(path);
  return extension.length > 0 ? path.slice(0, -extension.length) : path;
}

function routeIdFromRoutePath(routePath: string) {
  return trimSlashes(routePath).replace(/[^A-Za-z0-9_-]+/g, "_") || "index";
}

function firstGlobCharacterIndex(pattern: string) {
  const indexes = ["*", "?", "[", "{"]
    .map((character) => pattern.indexOf(character))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function globBaseFromPattern(pattern: string) {
  const normalized = normalizeIdPath(pattern);
  const globIndex = firstGlobCharacterIndex(normalized);
  if (globIndex < 0) return normalizeIdPath(dirname(normalized));
  const prefix = normalized.slice(0, globIndex);
  const slashIndex = prefix.lastIndexOf("/");
  return slashIndex < 0 ? "." : prefix.slice(0, slashIndex) || ".";
}

function slugForDeck(projectRelativePath: string, globBase: string) {
  const normalizedPath = normalizeIdPath(projectRelativePath);
  const normalizedBase = trimSlashes(normalizeIdPath(globBase));
  const relativeToGlobBase =
    normalizedBase.length > 0 && normalizedPath.startsWith(`${normalizedBase}/`)
      ? normalizedPath.slice(normalizedBase.length + 1)
      : normalizedPath;
  return trimSlashes(stripDeckExtension(relativeToGlobBase));
}

export function inferDeckFormat(filePath: string): SlidaDeckFormat {
  const extension = extname(filePath);

  if (extension === ".astro") return "astro";
  if (extension === ".mdx") return "mdx";

  throw new Error(
    `Unsupported Slida deck file extension: ${extension || "<none>"}. Supported extensions: ${SUPPORTED_DECK_EXTENSIONS.join(", ")}`,
  );
}

export async function resolveDeckFile(
  projectRoot: string,
  deckFile: string | undefined,
): Promise<SlidaResolvedDeck> {
  if (!deckFile) {
    throw new Error(
      "Missing Slida deck file. Usage: slida open <deck-file> or slida build <deck-file>.",
    );
  }

  const resolvedDeckFile = resolve(projectRoot, deckFile);
  const projectRelativePath = relative(projectRoot, resolvedDeckFile);

  if (
    projectRelativePath.length === 0 ||
    projectRelativePath.startsWith("..") ||
    isAbsolute(projectRelativePath)
  ) {
    throw new Error(`Slida deck file must be inside the project root: ${deckFile}`);
  }

  const format = inferDeckFormat(resolvedDeckFile);

  try {
    await access(resolvedDeckFile, constants.R_OK);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") throw new Error(`Slida deck file not found: ${deckFile}`);
    throw error;
  }

  const [realProjectRoot, realDeckFile] = await Promise.all([
    realpath(projectRoot),
    realpath(resolvedDeckFile),
  ]);
  if (!isInsideProject(realProjectRoot, realDeckFile)) {
    throw new Error(`Slida deck file must be inside the project root: ${deckFile}`);
  }

  const normalizedProjectRelativePath = toProjectPath(projectRelativePath);
  const metadata = await readDeckMetadata(resolvedDeckFile, normalizedProjectRelativePath, format);

  return {
    filePath: resolvedDeckFile,
    projectRelativePath: normalizedProjectRelativePath,
    format,
    metadata,
  };
}

export async function resolveDeckFilesFromGlob(
  projectRoot: string,
  patterns: string | string[],
  base = "/slides",
) {
  const sourceGlobs = (Array.isArray(patterns) ? patterns : [patterns]).filter(
    (pattern) => pattern.trim().length > 0,
  );
  if (sourceGlobs.length === 0)
    throw new Error("Missing Slida deck glob. Provide at least one deck glob.");

  const matchedByPath = new Map<string, { sourceGlob: string; globBase: string }>();
  for (const sourceGlob of sourceGlobs) {
    const globBase = globBaseFromPattern(sourceGlob);
    const matches = await glob(sourceGlob, {
      cwd: projectRoot,
      absolute: false,
      onlyFiles: true,
      expandDirectories: false,
    });
    for (const projectRelativePath of matches.sort((a, b) => a.localeCompare(b))) {
      // If a file is matched by multiple globs, the first configured glob owns its slug base.
      if (!matchedByPath.has(projectRelativePath)) {
        matchedByPath.set(projectRelativePath, { sourceGlob, globBase });
      }
    }
  }

  if (matchedByPath.size === 0) {
    throw new Error(`Slida deck glob matched no files: ${sourceGlobs.join(", ")}`);
  }

  const normalizedBase = normalizeSlidaBasePath(base);
  const entries = [...matchedByPath.entries()].sort(([a], [b]) => a.localeCompare(b));

  return Promise.all(
    entries.map(async ([projectRelativePath, match]) => {
      const deck = await resolveDeckFile(projectRoot, projectRelativePath);
      const slug = slugForDeck(deck.projectRelativePath, match.globBase);
      const routePath = joinRoutePath(normalizedBase, slug);
      const routeId = routeIdFromRoutePath(routePath);
      return {
        ...deck,
        sourceGlob: match.sourceGlob,
        globBase: normalizeIdPath(match.globBase),
        slug,
        routePath,
        routeId,
        virtualDeckModuleId: `${VIRTUAL_SLIDA_DECK_PREFIX}${routeId}`,
        virtualRouteModuleId: `${VIRTUAL_SLIDA_ROUTE_PREFIX}${routeId}.astro`,
      } satisfies SlidaResolvedDeckRoute;
    }),
  );
}

function assertNoDuplicateDeckRoutes(decks: SlidaResolvedDeckRoute[]) {
  const seenRoutes = new Map<string, SlidaResolvedDeckRoute>();
  const seenIds = new Map<string, SlidaResolvedDeckRoute>();
  for (const deck of decks) {
    const routeConflict = seenRoutes.get(deck.routePath);
    if (routeConflict) {
      throw new Error(
        `Slida deck route collision at ${deck.routePath}: ${routeConflict.projectRelativePath} and ${deck.projectRelativePath}`,
      );
    }
    seenRoutes.set(deck.routePath, deck);

    const idConflict = seenIds.get(deck.routeId);
    if (idConflict) {
      throw new Error(
        `Slida deck route id collision at ${deck.routeId}: ${idConflict.projectRelativePath} and ${deck.projectRelativePath}`,
      );
    }
    seenIds.set(deck.routeId, deck);
  }
}

export function createDeckRegistry(
  projectRoot: string,
  base: string,
  decks: SlidaResolvedDeckRoute[],
): SlidaDeckRegistry {
  assertNoDuplicateDeckRoutes(decks);
  const byFilePath = new Map<string, SlidaResolvedDeckRoute>();
  const byProjectRelativePath = new Map<string, SlidaResolvedDeckRoute>();
  const byRoutePath = new Map<string, SlidaResolvedDeckRoute>();
  const byRouteId = new Map<string, SlidaResolvedDeckRoute>();

  for (const deck of decks) {
    byFilePath.set(normalizeIdPath(deck.filePath), deck);
    byProjectRelativePath.set(normalizeIdPath(deck.projectRelativePath), deck);
    byRoutePath.set(deck.routePath, deck);
    byRouteId.set(deck.routeId, deck);
  }

  const registry: SlidaDeckRegistry = {
    projectRoot,
    base: normalizeSlidaBasePath(base),
    decks,
    byFilePath,
    byProjectRelativePath,
    byRoutePath,
    byRouteId,
    matchId(id) {
      const normalizedId = normalizeIdPath(stripQuery(id));
      return decks.find(
        (deck) =>
          normalizedId === normalizeIdPath(deck.filePath) ||
          normalizedId.endsWith(`/${deck.projectRelativePath}`) ||
          normalizedId === deck.virtualDeckModuleId ||
          normalizedId === deck.virtualRouteModuleId,
      );
    },
    matchMdxFile(file) {
      const candidates = [file.path, ...(file.history ?? [])]
        .filter((value): value is string => typeof value === "string")
        .map(normalizeIdPath);
      return decks.find((deck) =>
        candidates.some(
          (candidate) =>
            candidate === normalizeIdPath(deck.filePath) ||
            candidate.endsWith(`/${deck.projectRelativePath}`),
        ),
      );
    },
    getByRoutePath(routePath) {
      return byRoutePath.get(ensureLeadingSlash(routePath));
    },
    getByRouteId(routeId) {
      return byRouteId.get(routeId);
    },
  };

  return registry;
}

export async function resolveDeckRegistry(
  projectRoot: string,
  patterns: string | string[],
  base = "/slides",
) {
  const decks = await resolveDeckFilesFromGlob(projectRoot, patterns, base);
  return createDeckRegistry(projectRoot, base, decks);
}
