import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { discoverThemeLayouts } from "./theme-layouts.ts";
import type { DeckupNpmThemeDownloadRequest, DeckupNpmThemeOptions } from "./types.ts";

async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return false;
    throw error;
  }
}

export const NPM_DECKUP_THEME_PREFIX = "npm:";
export const DECKUP_THEME_CACHE_ENV = "DECKUP_THEME_CACHE_DIR";

const cacheMetadataFileName = "deckup-npm-theme.json";
const pacoteCacheDirName = "_cacache";

export interface DeckupNpmThemeSource {
  originalName: string;
  spec: string;
  packageName: string;
  version?: string;
}

export interface DeckupCachedNpmThemePackage {
  filePath: string;
  packageName: string;
  packageRoot: string;
  cacheEntryDir: string;
  version: string;
  source: "package";
}

export interface NpmThemePackageManifest {
  name: string;
  version: string;
  _resolved: string;
  _integrity?: string;
}

export interface NpmThemeInstallOptions {
  cache: string;
  integrity?: string;
}

export interface NpmThemeInstallOperations {
  manifest(spec: string, options: { cache: string }): Promise<NpmThemePackageManifest>;
  extract(spec: string, target: string, options: NpmThemeInstallOptions): Promise<unknown>;
}

/** Private lock-acquisition timing seam; not part of the public npm theme contract. */
interface NpmThemeCacheLockClock {
  now(): number;
  wait(ms: number): Promise<void>;
}

/** Private cache lifecycle fault-injection seam; not part of the public npm theme contract. */
interface NpmThemeCacheLifecycleOperations {
  removeTempEntry(tempEntryDir: string): Promise<void>;
  releaseLock(lockDir: string): Promise<void>;
}

export interface DeckupNpmThemeResolveOptions extends DeckupNpmThemeOptions {
  /** @internal Test seam for avoiding real npm registry/network access. */
  operations?: NpmThemeInstallOperations;
}

const exactVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

class NpmThemeCacheValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NpmThemeCacheValidationError";
  }
}

function envString(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function defaultThemeCacheDir() {
  const home = homedir();

  if (process.platform === "darwin") {
    return join(home, "Library", "Caches", "deckup", "npm-themes");
  }

  if (process.platform === "win32") {
    return join(
      envString("LOCALAPPDATA") ?? join(home, "AppData", "Local"),
      "deckup",
      "npm-themes",
    );
  }

  return join(envString("XDG_CACHE_HOME") ?? join(home, ".cache"), "deckup", "npm-themes");
}

export function resolveNpmThemeCacheDir(cacheDir?: string) {
  return resolve(cacheDir ?? envString(DECKUP_THEME_CACHE_ENV) ?? defaultThemeCacheDir());
}

export function parseNpmThemeSource(themeName: string): DeckupNpmThemeSource | undefined {
  if (!themeName.startsWith(NPM_DECKUP_THEME_PREFIX)) return undefined;

  const spec = themeName.slice(NPM_DECKUP_THEME_PREFIX.length).trim();
  if (spec.length === 0) {
    throw new TypeError("Deckup npm theme must include a package name after the npm: prefix.");
  }

  const parsed = parseNpmPackageSpec(spec);
  if (!parsed) {
    throw new TypeError(
      `Deckup npm theme ${JSON.stringify(themeName)} must reference an npm registry package.`,
    );
  }

  if (parsed.versionSpecifier !== undefined && !exactVersionPattern.test(parsed.versionSpecifier)) {
    throw new TypeError(
      `Deckup npm theme ${JSON.stringify(themeName)} must use npm:package or npm:package@version.`,
    );
  }

  return {
    originalName: themeName,
    spec,
    packageName: parsed.packageName,
    version: parsed.versionSpecifier,
  };
}

function parseNpmPackageSpec(spec: string) {
  let packageName: string;
  let versionSpecifier: string | undefined;
  let hasVersionSpecifier = false;

  if (spec.startsWith("@")) {
    const slashIndex = spec.indexOf("/");
    if (slashIndex < 0) return undefined;
    const versionIndex = spec.indexOf("@", slashIndex + 1);
    if (versionIndex >= 0) {
      packageName = spec.slice(0, versionIndex);
      versionSpecifier = spec.slice(versionIndex + 1);
      hasVersionSpecifier = true;
    } else {
      packageName = spec;
    }
  } else {
    const versionIndex = spec.indexOf("@");
    if (versionIndex >= 0) {
      packageName = spec.slice(0, versionIndex);
      versionSpecifier = spec.slice(versionIndex + 1);
      hasVersionSpecifier = true;
    } else {
      packageName = spec;
    }
  }

  if (!packageNamePattern.test(packageName)) return undefined;
  if (hasVersionSpecifier && (!versionSpecifier || versionSpecifier.trim() !== versionSpecifier)) {
    throw new TypeError(
      `Deckup npm theme ${JSON.stringify(`${NPM_DECKUP_THEME_PREFIX}${spec}`)} must use npm:package or npm:package@version.`,
    );
  }
  return { packageName, versionSpecifier };
}

function npmThemeCacheKey(source: DeckupNpmThemeSource) {
  const packageSlug = source.packageName.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const digest = createHash("sha256").update(source.spec).digest("hex").slice(0, 16);
  return `${packageSlug}-${digest}`;
}

export function getNpmThemeCacheEntryDir(cacheDir: string, source: DeckupNpmThemeSource) {
  return join(resolveNpmThemeCacheDir(cacheDir), "packages", npmThemeCacheKey(source));
}

function pacoteCacheDir(cacheDir: string) {
  return join(cacheDir, pacoteCacheDirName);
}

async function loadDefaultNpmThemeInstallOperations(): Promise<NpmThemeInstallOperations> {
  const imported = await import("pacote");
  return imported.default;
}

function metadataPath(cacheEntryDir: string) {
  return join(cacheEntryDir, cacheMetadataFileName);
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function exposesPackageJson(exportsField: unknown) {
  if (exportsField === undefined) return true;
  return (
    typeof exportsField === "object" &&
    exportsField !== null &&
    Object.hasOwn(exportsField, "./package.json")
  );
}

async function assertDirectory(filePath: string, context: string) {
  const fileStat = await stat(filePath);
  if (!fileStat.isDirectory()) {
    throw new NpmThemeCacheValidationError(`${context} must be a directory: ${filePath}`);
  }
}

async function readPackageJson(packageRoot: string) {
  const packageJsonPath = join(packageRoot, "package.json");
  let rawPackageJson: string;
  try {
    rawPackageJson = await readFile(packageJsonPath, "utf8");
  } catch (error) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme is missing package metadata: ${packageJsonPath}`,
      { cause: error },
    );
  }

  let packageJson: { name?: unknown; version?: unknown; exports?: unknown };
  try {
    packageJson = JSON.parse(rawPackageJson) as {
      name?: unknown;
      version?: unknown;
      exports?: unknown;
    };
  } catch (error) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme package metadata is not valid JSON: ${packageJsonPath}`,
      { cause: error },
    );
  }

  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme package metadata must include string name and version: ${packageJsonPath}`,
    );
  }

  if (!exposesPackageJson(packageJson.exports)) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme package metadata must expose ./package.json: ${packageJsonPath}`,
    );
  }

  return { filePath: packageJsonPath, name: packageJson.name, version: packageJson.version };
}

type CacheMetadata = {
  source?: unknown;
  spec?: unknown;
  packageName?: unknown;
  version?: unknown;
};

async function readCacheMetadata(source: DeckupNpmThemeSource, cacheEntryDir: string) {
  const filePath = metadataPath(cacheEntryDir);
  let rawMetadata: string;
  try {
    rawMetadata = await readFile(filePath, "utf8");
  } catch (error) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme metadata is missing: ${filePath}`,
      {
        cause: error,
      },
    );
  }

  let metadata: CacheMetadata;
  try {
    metadata = JSON.parse(rawMetadata) as CacheMetadata;
  } catch (error) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme metadata is not valid JSON: ${filePath}`,
      { cause: error },
    );
  }

  if (
    metadata.source !== source.originalName ||
    metadata.spec !== source.spec ||
    metadata.packageName !== source.packageName ||
    typeof metadata.version !== "string" ||
    (source.version && metadata.version !== source.version)
  ) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme metadata does not match ${source.spec}: ${filePath}`,
    );
  }

  return { filePath, version: metadata.version };
}

async function validateCachedNpmThemePackage(
  source: DeckupNpmThemeSource,
  cacheEntryDir: string,
): Promise<DeckupCachedNpmThemePackage> {
  const packageRoot = join(cacheEntryDir, "package");
  const packageJson = await readPackageJson(packageRoot);

  if (packageJson.name !== source.packageName) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme package name mismatch for ${source.spec}: expected ${source.packageName}, got ${packageJson.name}.`,
    );
  }

  if (source.version && packageJson.version !== source.version) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme package version mismatch for ${source.spec}: expected ${source.version}, got ${packageJson.version}.`,
    );
  }

  const realPackageRoot = await realpath(packageRoot);
  await discoverThemeLayouts(source.originalName, join(realPackageRoot, "layouts"));

  return {
    filePath: join(realPackageRoot, "package.json"),
    packageName: packageJson.name,
    packageRoot: realPackageRoot,
    cacheEntryDir,
    version: packageJson.version,
    source: "package",
  };
}

async function validateCachedNpmThemeEntry(source: DeckupNpmThemeSource, cacheEntryDir: string) {
  const metadata = await readCacheMetadata(source, cacheEntryDir);
  const cachedTheme = await validateCachedNpmThemePackage(source, cacheEntryDir);
  if (metadata.version !== cachedTheme.version) {
    throw new NpmThemeCacheValidationError(
      `Cached Deckup npm theme metadata version mismatch for ${source.spec}: expected ${metadata.version}, got ${cachedTheme.version}.`,
    );
  }
  return cachedTheme;
}

async function defaultConfirmNpmThemeDownload(request: DeckupNpmThemeDownloadRequest) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      `Deckup npm theme ${JSON.stringify(request.spec)} is not cached at ${request.cacheDir}. Re-run in an interactive terminal to approve the download, or pre-populate the cache with this theme.`,
    );
  }

  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      `Download Deckup npm theme ${request.spec} into ${request.cacheDir}? [y/N] `,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function confirmNpmThemeDownload(
  source: DeckupNpmThemeSource,
  cacheDir: string,
  options: DeckupNpmThemeResolveOptions,
) {
  const request = { spec: source.spec, packageName: source.packageName, cacheDir };
  const confirmed = options.confirmDownload
    ? await options.confirmDownload(request)
    : await defaultConfirmNpmThemeDownload(request);

  if (!confirmed) {
    throw new Error(`Deckup npm theme download cancelled: ${source.spec}`);
  }
}

async function writeCacheMetadata(
  source: DeckupNpmThemeSource,
  cacheEntryDir: string,
  manifest: NpmThemePackageManifest,
) {
  await writeFile(
    metadataPath(cacheEntryDir),
    `${JSON.stringify(
      {
        source: source.originalName,
        spec: source.spec,
        packageName: manifest.name,
        version: manifest.version,
      },
      null,
      2,
    )}\n`,
  );
}

const cacheLockPollIntervalMs = 50;
const cacheLockAcquireTimeoutMs = 60_000;

const defaultCacheLockClock: NpmThemeCacheLockClock = {
  now: () => performance.now(),
  wait: (ms) => sleep(ms),
};

const defaultCacheLifecycleOperations: NpmThemeCacheLifecycleOperations = {
  removeTempEntry: (tempEntryDir) => rm(tempEntryDir, { force: true, recursive: true }),
  releaseLock: (lockDir) => rm(lockDir, { force: true, recursive: true }),
};

class NpmThemeCacheLockTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NpmThemeCacheLockTimeoutError";
  }
}

async function acquireCacheEntryLock(
  lockDir: string,
  locksDir: string,
  source: DeckupNpmThemeSource,
  clock: NpmThemeCacheLockClock,
): Promise<void> {
  await mkdir(locksDir, { recursive: true });

  const deadline = clock.now() + cacheLockAcquireTimeoutMs;
  for (;;) {
    try {
      await mkdir(lockDir);
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;

      if (clock.now() >= deadline) {
        throw new NpmThemeCacheLockTimeoutError(
          `Deckup timed out after ${cacheLockAcquireTimeoutMs}ms waiting for the npm theme cache lock for ${source.spec} at ${lockDir}. Remove this lock only after confirming no Deckup process is using it.`,
        );
      }

      await clock.wait(cacheLockPollIntervalMs);
    }
  }
}

async function withCacheEntryLock<T>(
  cacheDir: string,
  source: DeckupNpmThemeSource,
  lifecycle: NpmThemeCacheLifecycleOperations,
  clock: NpmThemeCacheLockClock,
  run: () => Promise<T>,
): Promise<T> {
  const locksDir = join(cacheDir, "locks");
  const lockDir = join(locksDir, `${npmThemeCacheKey(source)}.lock`);
  await acquireCacheEntryLock(lockDir, locksDir, source, clock);

  let result: T;
  try {
    result = await run();
  } catch (primaryError) {
    try {
      await lifecycle.releaseLock(lockDir);
    } catch (releaseError) {
      throw new AggregateError(
        [primaryError, releaseError],
        `Deckup npm theme cache operation for ${source.spec} failed and lock release also failed: ${lockDir}`,
      );
    }
    throw primaryError;
  }

  await lifecycle.releaseLock(lockDir);
  return result;
}

async function promoteExtractedPackage(
  tempEntryDir: string,
  cacheEntryDir: string,
  source: DeckupNpmThemeSource,
) {
  await mkdir(join(cacheEntryDir, ".."), { recursive: true });
  await rename(tempEntryDir, cacheEntryDir);
  return validateCachedNpmThemeEntry(source, cacheEntryDir);
}

async function resolveCachedNpmThemePackageImpl(
  source: DeckupNpmThemeSource,
  options: DeckupNpmThemeResolveOptions,
  clock: NpmThemeCacheLockClock,
  lifecycle: NpmThemeCacheLifecycleOperations,
): Promise<DeckupCachedNpmThemePackage> {
  const cacheDir = resolveNpmThemeCacheDir(options.cacheDir);
  const cacheEntryDir = getNpmThemeCacheEntryDir(cacheDir, source);

  return withCacheEntryLock(cacheDir, source, lifecycle, clock, async () => {
    if (await pathExists(cacheEntryDir)) {
      await assertDirectory(cacheEntryDir, "Cached Deckup npm theme entry");
      return await validateCachedNpmThemeEntry(source, cacheEntryDir);
    }

    await confirmNpmThemeDownload(source, cacheDir, options);

    const operations = options.operations ?? (await loadDefaultNpmThemeInstallOperations());
    const npmCacheDir = pacoteCacheDir(cacheDir);
    const tempRoot = join(cacheDir, "tmp");
    await mkdir(tempRoot, { recursive: true });
    const tempEntryDir = await mkdtemp(join(tempRoot, `${npmThemeCacheKey(source)}-`));
    const tempPackageRoot = join(tempEntryDir, "package");

    try {
      const manifest = await operations.manifest(source.spec, { cache: npmCacheDir });
      if (manifest.name !== source.packageName) {
        throw new Error(
          `Resolved Deckup npm theme package name mismatch for ${source.spec}: expected ${source.packageName}, got ${manifest.name}.`,
        );
      }
      if (source.version && manifest.version !== source.version) {
        throw new Error(
          `Resolved Deckup npm theme package version mismatch for ${source.spec}: expected ${source.version}, got ${manifest.version}.`,
        );
      }

      const extractSpec = manifest._resolved;
      await mkdir(tempPackageRoot, { recursive: true });
      await operations.extract(extractSpec, tempPackageRoot, {
        cache: npmCacheDir,
        ...(manifest._integrity ? { integrity: manifest._integrity } : {}),
      });
      await validateCachedNpmThemePackage(source, tempEntryDir);
      await writeCacheMetadata(source, tempEntryDir, manifest);
      return await promoteExtractedPackage(tempEntryDir, cacheEntryDir, source);
    } catch (primaryError) {
      try {
        await lifecycle.removeTempEntry(tempEntryDir);
      } catch (cleanupError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          `Deckup npm theme download for ${source.spec} failed and temp cleanup also failed: ${tempEntryDir}`,
        );
      }
      throw primaryError;
    }
  });
}

export async function resolveCachedNpmThemePackage(
  source: DeckupNpmThemeSource,
  options: DeckupNpmThemeResolveOptions = {},
): Promise<DeckupCachedNpmThemePackage> {
  return resolveCachedNpmThemePackageImpl(
    source,
    options,
    defaultCacheLockClock,
    defaultCacheLifecycleOperations,
  );
}

/**
 * @internal Test-only entry point. Not part of the public npm theme contract:
 * do not export this from packages/core/src/index.ts or apps/cli/src/npm-theme.ts.
 * Injects a per-call lock clock and/or cache lifecycle seam so tests can
 * exercise lock-timeout and lifecycle-fault paths without a module-global
 * mutable seam. Omitted overrides fall back to the same production defaults
 * used by resolveCachedNpmThemePackage.
 */
export async function resolveCachedNpmThemePackageForTests(
  source: DeckupNpmThemeSource,
  options: DeckupNpmThemeResolveOptions,
  overrides: {
    lockClock?: NpmThemeCacheLockClock;
    lifecycle?: NpmThemeCacheLifecycleOperations;
  } = {},
): Promise<DeckupCachedNpmThemePackage> {
  return resolveCachedNpmThemePackageImpl(
    source,
    options,
    overrides.lockClock ?? defaultCacheLockClock,
    overrides.lifecycle ?? defaultCacheLifecycleOperations,
  );
}
