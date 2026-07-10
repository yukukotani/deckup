import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import type { DeckupResolvedDeck } from "./types.ts";

export const PNG_SLIDE_WIDTH = 1600;
export const PNG_SLIDE_HEIGHT = 900;

export interface DeckupPngOutputSafetyOptions {
  projectRoot: string;
  deckFile: string;
  stagingDir: string;
  outputDir: string;
}

type ComparisonPaths = DeckupPngOutputSafetyOptions;

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function isSameOrInside(rootDir: string, filePath: string) {
  const relativePath = relative(rootDir, filePath);
  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

function pathsOverlap(firstPath: string, secondPath: string) {
  return isSameOrInside(firstPath, secondPath) || isSameOrInside(secondPath, firstPath);
}

function isFilesystemRoot(filePath: string) {
  const absolutePath = resolve(filePath);
  return absolutePath === parse(absolutePath).root;
}

async function resolveComparisonPath(filePath: string) {
  const suffix: string[] = [];
  let candidate = resolve(filePath);

  while (true) {
    try {
      return resolve(await realpath(candidate), ...suffix.reverse());
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }

      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      suffix.push(basename(candidate));
      candidate = parent;
    }
  }
}

function unsafeOutputError(outputDir: string, reason: string) {
  return new Error(`Deckup PNG output directory is unsafe to delete (${reason}): ${outputDir}`);
}

function assertSafeComparisonPaths(paths: ComparisonPaths) {
  if (isFilesystemRoot(paths.outputDir)) {
    throw unsafeOutputError(paths.outputDir, "filesystem root");
  }
  if (resolve(paths.outputDir) === resolve(paths.projectRoot)) {
    throw unsafeOutputError(paths.outputDir, "project root");
  }
  if (isSameOrInside(paths.outputDir, paths.deckFile)) {
    throw unsafeOutputError(paths.outputDir, "contains the source deck");
  }
  if (pathsOverlap(paths.outputDir, paths.stagingDir)) {
    throw unsafeOutputError(paths.outputDir, "overlaps the static build staging directory");
  }
}

export function normalizePngOutputDir(
  projectRoot: string,
  deck: DeckupResolvedDeck,
  out = basename(deck.filePath, extname(deck.filePath)),
) {
  return resolve(projectRoot, out);
}

export function formatPngSlideFileName(slideNumber: number) {
  if (!Number.isSafeInteger(slideNumber) || slideNumber < 1) {
    throw new Error(`Invalid Deckup PNG slide number: ${slideNumber}`);
  }
  return `slide-${String(slideNumber).padStart(3, "0")}.png`;
}

export function resolvePngFiles(outputDir: string, slideNumbers: number[]) {
  return slideNumbers.map((slideNumber) => join(outputDir, formatPngSlideFileName(slideNumber)));
}

export function parsePngSlideSelection(selection: string | undefined, pageCount: number) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error(`Invalid Deckup slide count for PNG export: ${pageCount}`);
  }
  if (selection === undefined) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const normalized = selection.trim();
  if (normalized.length === 0) {
    throw new Error("Invalid Deckup PNG slide selection: value must not be empty.");
  }

  const ranges = normalized.split(",").map((rawSegment) => {
    const segment = rawSegment.trim();
    const match = /^(\d+)(?:-(\d+))?$/.exec(segment);
    if (!match) {
      throw new Error(`Invalid Deckup PNG slide selection segment: ${JSON.stringify(segment)}.`);
    }

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
      throw new Error(`Invalid Deckup PNG slide selection segment: ${JSON.stringify(segment)}.`);
    }
    if (start > end) {
      throw new Error(
        `Invalid Deckup PNG slide range: ${segment}. Range start must not exceed range end.`,
      );
    }
    if (end > pageCount) {
      throw new Error(
        `Deckup PNG slide selection is out of range: ${segment}. Deck contains ${pageCount} slides.`,
      );
    }
    return { start, end };
  });

  const selected = new Set<number>();
  for (const { start, end } of ranges) {
    for (let slideNumber = start; slideNumber <= end; slideNumber += 1) {
      selected.add(slideNumber);
    }
  }
  return [...selected].sort((first, second) => first - second);
}

export async function assertSafePngOutputDirectory(options: DeckupPngOutputSafetyOptions) {
  const lexicalPaths: ComparisonPaths = {
    projectRoot: resolve(options.projectRoot),
    deckFile: resolve(options.deckFile),
    stagingDir: resolve(options.stagingDir),
    outputDir: resolve(options.outputDir),
  };
  assertSafeComparisonPaths(lexicalPaths);

  const [projectRoot, deckFile, stagingDir, outputDir] = await Promise.all([
    resolveComparisonPath(lexicalPaths.projectRoot),
    resolveComparisonPath(lexicalPaths.deckFile),
    resolveComparisonPath(lexicalPaths.stagingDir),
    resolveComparisonPath(lexicalPaths.outputDir),
  ]);
  assertSafeComparisonPaths({ projectRoot, deckFile, stagingDir, outputDir });
}
