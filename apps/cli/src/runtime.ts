import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SlidaRuntimePaths } from "./types.ts";

export { pathExists } from "./fs-utils.ts";

import { pathExists } from "./fs-utils.ts";

export const SLIDA_WORK_DIR = ".slida";
export const SLIDA_RUNTIME_DIR = "runtime";

const fallbackIndex = `---
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slida runtime unavailable</title>
  </head>
  <body>
    <main>
      <h1>Slida runtime unavailable</h1>
      <p>The packaged Slida runtime files were not found. Rebuild @slida/cli and try again.</p>
    </main>
  </body>
</html>
`;

export function resolveProjectRoot(root = process.cwd()) {
  return resolve(root);
}

export function resolveRuntimeSourceDir() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../runtime");
}

async function writeFallbackRuntime(runtimeOutDir: string) {
  const pagesDir = join(runtimeOutDir, "pages");
  await mkdir(pagesDir, { recursive: true });
  await writeFile(join(pagesDir, "index.astro"), fallbackIndex);
}

export async function prepareRuntime(
  root = process.cwd(),
  runtimeSourceDir = resolveRuntimeSourceDir(),
): Promise<SlidaRuntimePaths> {
  const projectRoot = resolveProjectRoot(root);
  const runtimeOutDir = join(projectRoot, SLIDA_WORK_DIR, SLIDA_RUNTIME_DIR);

  await rm(runtimeOutDir, { force: true, recursive: true });
  await mkdir(dirname(runtimeOutDir), { recursive: true });

  if (await pathExists(runtimeSourceDir)) {
    await cp(runtimeSourceDir, runtimeOutDir, { recursive: true });
  } else {
    await writeFallbackRuntime(runtimeOutDir);
  }

  return { projectRoot, runtimeSourceDir, runtimeOutDir };
}
