import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type { SlidaDeckFormat, SlidaResolvedDeck } from "./types.ts";

export const SUPPORTED_DECK_EXTENSIONS = [".astro", ".mdx"] as const;

function toProjectPath(path: string) {
  return path.split(sep).join("/");
}

function isInsideProject(projectRoot: string, filePath: string) {
  const relativePath = relative(projectRoot, filePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export function inferDeckFormat(filePath: string): SlidaDeckFormat {
  const extension = extname(filePath);

  if (extension === ".astro") {
    return "astro";
  }

  if (extension === ".mdx") {
    return "mdx";
  }

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
    if (code === "ENOENT") {
      throw new Error(`Slida deck file not found: ${deckFile}`);
    }
    throw error;
  }

  const [realProjectRoot, realDeckFile] = await Promise.all([
    realpath(projectRoot),
    realpath(resolvedDeckFile),
  ]);

  if (!isInsideProject(realProjectRoot, realDeckFile)) {
    throw new Error(`Slida deck file must be inside the project root: ${deckFile}`);
  }

  return {
    filePath: resolvedDeckFile,
    projectRelativePath: toProjectPath(projectRelativePath),
    format,
  };
}
