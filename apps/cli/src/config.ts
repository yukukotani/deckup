import { join } from "node:path";

import { createJiti } from "jiti";

import type {
  DeckupBuildOptions,
  DeckupConfig,
  DeckupDevOptions,
  DeckupExportOptions,
  DeckupLoadedConfig,
} from "./types.ts";
import { pathExists } from "./fs-utils.ts";

type DeckupConfigResolveOptions = DeckupDevOptions | DeckupBuildOptions | DeckupExportOptions;

export const DECKUP_CONFIG_FILES = [
  "deckup.config.ts",
  "deckup.config.js",
  "deckup.config.mjs",
  "deckup.config.mts",
  "deckup.config.cjs",
  "deckup.config.cts",
] as const;

export function defineConfig(config: DeckupConfig): DeckupConfig {
  return config;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export async function findDeckupConfigFiles(projectRoot: string): Promise<string[]> {
  const filePaths: string[] = [];

  for (const fileName of DECKUP_CONFIG_FILES) {
    const filePath = join(projectRoot, fileName);
    if (await pathExists(filePath)) {
      filePaths.push(filePath);
    }
  }

  return filePaths;
}

export async function loadDeckupConfig(projectRoot: string): Promise<DeckupLoadedConfig> {
  const filePaths = await findDeckupConfigFiles(projectRoot);

  if (filePaths.length === 0) {
    return { config: {} };
  }

  if (filePaths.length > 1) {
    throw new Error(
      `Multiple Deckup config files found:\n${filePaths.map((filePath) => `- ${filePath}`).join("\n")}`,
    );
  }

  const [filePath] = filePaths;
  const jiti = createJiti(import.meta.url, {
    extensions: [".ts", ".js", ".mjs", ".mts", ".cjs", ".cts"],
  });
  const loaded = await jiti.import<unknown>(filePath, { default: true });

  if (!isPlainObject(loaded)) {
    throw new TypeError(`Deckup config must default-export an object: ${filePath}`);
  }

  return { config: loaded as DeckupConfig, filePath };
}

export function resolveDeckupConfig(
  config: DeckupConfig,
  options: DeckupConfigResolveOptions = {},
): DeckupConfig {
  const devOptions = options as DeckupDevOptions;
  return {
    ...config,
    port: devOptions.port ?? config.port,
  };
}
