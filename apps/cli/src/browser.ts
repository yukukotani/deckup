import {
  Browser,
  ChromeReleaseChannel,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
  uninstall,
} from "@puppeteer/browsers";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { pathExists } from "./runtime.ts";

export const DECKUP_BROWSER_CACHE_ENV = "DECKUP_BROWSER_CACHE_DIR";
export const DECKUP_CHROMIUM_EXECUTABLE_ENV = "DECKUP_CHROMIUM_EXECUTABLE_PATH";

export interface DeckupChromiumOptions {
  executablePath?: string;
  cacheDir?: string;
}

type ChromiumInstallOptions = Parameters<typeof uninstall>[0];

export interface ChromiumInstallOperations {
  install(options: ChromiumInstallOptions): Promise<unknown>;
  uninstall(options: ChromiumInstallOptions): Promise<void>;
}

function envString(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function defaultBrowserCacheDir() {
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Caches", "deckup", "browsers");
  }

  if (process.platform === "win32") {
    return join(envString("LOCALAPPDATA") ?? join(home, "AppData", "Local"), "deckup", "browsers");
  }

  return join(envString("XDG_CACHE_HOME") ?? join(home, ".cache"), "deckup", "browsers");
}

export function resolveBrowserCacheDir(cacheDir?: string) {
  return resolve(cacheDir ?? envString(DECKUP_BROWSER_CACHE_ENV) ?? defaultBrowserCacheDir());
}

function isMissingCachedExecutableError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("The browser folder (") &&
    error.message.includes(") exists but the executable (") &&
    error.message.includes(") is missing")
  );
}

export async function installChromiumWithCacheRepair(
  options: ChromiumInstallOptions,
  operations: ChromiumInstallOperations = { install, uninstall },
) {
  try {
    await operations.install(options);
  } catch (error) {
    if (!isMissingCachedExecutableError(error)) {
      throw error;
    }

    await operations.uninstall(options);
    await operations.install(options);
  }
}

export async function resolveChromiumExecutablePath(options: DeckupChromiumOptions = {}) {
  const explicitPath = options.executablePath ?? envString(DECKUP_CHROMIUM_EXECUTABLE_ENV);
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("Unsupported platform for Deckup browser export Chromium download.");
  }

  const cacheDir = resolveBrowserCacheDir(options.cacheDir);
  const buildId = await resolveBuildId(Browser.CHROME, platform, ChromeReleaseChannel.STABLE);
  const executablePath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir,
    platform,
  });

  if (!(await pathExists(executablePath))) {
    await installChromiumWithCacheRepair({ browser: Browser.CHROME, buildId, cacheDir, platform });
  }

  if (!(await pathExists(executablePath))) {
    throw new Error(
      `Downloaded Deckup browser export Chromium executable is missing: ${executablePath}`,
    );
  }

  return executablePath;
}
