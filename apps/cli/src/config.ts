import { access } from "node:fs/promises";
import { join } from "node:path";

import { createJiti } from "jiti";

import type {
  SlidaBuildOptions,
  SlidaConfig,
  SlidaDevOptions,
  SlidaLoadedConfig,
} from "./types.ts";

export const SLIDA_CONFIG_FILES = [
  "slida.config.ts",
  "slida.config.js",
  "slida.config.mjs",
  "slida.config.mts",
  "slida.config.cjs",
  "slida.config.cts",
] as const;

export function defineConfig(config: SlidaConfig): SlidaConfig {
  return config;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export async function findSlidaConfigFiles(projectRoot: string): Promise<string[]> {
  const filePaths: string[] = [];

  for (const fileName of SLIDA_CONFIG_FILES) {
    const filePath = join(projectRoot, fileName);
    if (await fileExists(filePath)) {
      filePaths.push(filePath);
    }
  }

  return filePaths;
}

export async function loadSlidaConfig(projectRoot: string): Promise<SlidaLoadedConfig> {
  const filePaths = await findSlidaConfigFiles(projectRoot);

  if (filePaths.length === 0) {
    return { config: {} };
  }

  if (filePaths.length > 1) {
    throw new Error(
      `Multiple Slida config files found:\n${filePaths.map((filePath) => `- ${filePath}`).join("\n")}`,
    );
  }

  const [filePath] = filePaths;
  const jiti = createJiti(import.meta.url, {
    extensions: [".ts", ".js", ".mjs", ".mts", ".cjs", ".cts"],
  });
  const loaded = await jiti.import<unknown>(filePath, { default: true });

  if (!isPlainObject(loaded)) {
    throw new TypeError(`Slida config must default-export an object: ${filePath}`);
  }

  return { config: loaded as SlidaConfig, filePath };
}

export function resolveSlidaConfig(
  config: SlidaConfig,
  options: SlidaDevOptions | SlidaBuildOptions = {},
): SlidaConfig {
  const devOptions = options as SlidaDevOptions;
  return {
    ...config,
    port: devOptions.port ?? config.port,
  };
}
