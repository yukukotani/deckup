import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeckupRuntimePaths } from "./types.ts";

export { pathExists } from "./fs-utils.ts";

export const DECKUP_WORK_DIR = ".deckup";
export const DECKUP_RUNTIME_DIR = "runtime";

export function resolveProjectRoot(root = process.cwd()) {
  return resolve(root);
}

export function resolveRuntimeSourceDir() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../runtime");
}

export async function prepareRuntime(
  root = process.cwd(),
  runtimeSourceDir = resolveRuntimeSourceDir(),
): Promise<DeckupRuntimePaths> {
  const projectRoot = resolveProjectRoot(root);
  const runtimeOutDir = join(projectRoot, DECKUP_WORK_DIR, DECKUP_RUNTIME_DIR);

  await rm(runtimeOutDir, { force: true, recursive: true });
  await mkdir(runtimeOutDir, { recursive: true });

  return { projectRoot, runtimeSourceDir, runtimeOutDir };
}
