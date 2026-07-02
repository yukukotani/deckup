import {
  Browser,
  ChromeReleaseChannel,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { pathExists } from "./runtime.ts";

export const SLIDA_BROWSER_CACHE_ENV = "SLIDA_BROWSER_CACHE_DIR";
export const SLIDA_CHROMIUM_EXECUTABLE_ENV = "SLIDA_CHROMIUM_EXECUTABLE_PATH";

export interface SlidaChromiumOptions {
  executablePath?: string;
  cacheDir?: string;
}

function envString(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function defaultBrowserCacheDir() {
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Caches", "slida", "browsers");
  }

  if (process.platform === "win32") {
    return join(envString("LOCALAPPDATA") ?? join(home, "AppData", "Local"), "slida", "browsers");
  }

  return join(envString("XDG_CACHE_HOME") ?? join(home, ".cache"), "slida", "browsers");
}

export function resolveBrowserCacheDir(cacheDir?: string) {
  return resolve(cacheDir ?? envString(SLIDA_BROWSER_CACHE_ENV) ?? defaultBrowserCacheDir());
}

export async function resolveChromiumExecutablePath(options: SlidaChromiumOptions = {}) {
  const explicitPath = options.executablePath ?? envString(SLIDA_CHROMIUM_EXECUTABLE_ENV);
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("Unsupported platform for Slida PDF export Chromium download.");
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
    await install({ browser: Browser.CHROME, buildId, cacheDir, platform });
  }

  return executablePath;
}
