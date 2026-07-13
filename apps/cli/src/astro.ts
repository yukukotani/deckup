import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  countAstroDeckPages,
  countMdxDeckPages,
  createGeneratedPageComponentSource,
  createSingleDeckRegistry,
  remarkDeckupMdxPages,
  resolveDeckFile,
  resolveDeckupThemeLayouts,
  uniqueStrings,
  type RawAstroCodeHighlightOptions,
  type DeckupResolvedDeck,
  type DeckupResolvedTheme,
  type DeckupRuntimePaths,
} from "@deckup/core";
import { build, dev, type AstroInlineConfig } from "astro";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveChromiumExecutablePath } from "./browser.ts";
import {
  resolveDeckupBuiltInIntegrations,
  writeDeckupBuiltInIntegrationAssets,
  type DeckupResolvedBuiltInIntegrations,
} from "./built-in-integrations.ts";
import { loadDeckupConfig, resolveDeckupConfig } from "./config.ts";
import { resolveProjectRoot, resolveRuntimeSourceDir } from "./runtime.ts";
import { createDeckupCliIntegration } from "./integration.ts";
import {
  PNG_SLIDE_HEIGHT,
  PNG_SLIDE_WIDTH,
  assertSafePngOutputDirectory,
  normalizePngOutputDir,
  parsePngSlideSelection,
  resolvePngFiles,
} from "./png.ts";
import type {
  DeckupBrowserOptions,
  DeckupBuildOptions,
  DeckupConfig,
  DeckupDevOptions,
  DeckupDevResult,
  DeckupExportOptions,
  DeckupExportResult,
  DeckupPngExportOptions,
  DeckupPngExportResult,
  DeckupResolvedConfig,
} from "./types.ts";

export type { RawAstroCodeHighlightOptions } from "@deckup/core";

export const DEFAULT_DEV_HOST = "127.0.0.1";
export const DEFAULT_DEV_PORT = 4321;
export const DEFAULT_BUILD_OUT_DIR = "dist";
export const DEFAULT_EXPORT_SEARCH_PARAM = "deckup-export";
export const DEFAULT_EXPORT_SEARCH_VALUE = "pdf";
export const PDF_SLIDE_WIDTH = "16in";
export const PDF_SLIDE_HEIGHT = "9in";
const DEFAULT_CODE_HIGHLIGHT_THEME = "github-dark";

const pngSlideSelector = "[data-deckup-slide]";
const pngCaptureStyle = `
[data-deckup-shell] {
  width: ${PNG_SLIDE_WIDTH}px !important;
  height: ${PNG_SLIDE_HEIGHT}px !important;
  border: 0 !important;
}
[data-deckup-navigation] {
  display: none !important;
}
`;

/** @internal Test seam; not exported from the package index. */
export interface DeckupPngLocator {
  nth(index: number): DeckupPngLocator;
  boundingBox(): Promise<{ width: number; height: number } | null>;
  screenshot(options: {
    path: string;
    type: "png";
    animations: "disabled";
    caret: "hide";
    scale: "css";
  }): Promise<Buffer>;
}

/** @internal Test seam; not exported from the package index. */
export interface DeckupPngPage {
  goto(url: string, options: { waitUntil: "networkidle" }): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  evaluate<Result, Argument>(
    pageFunction: (argument: Argument) => Result | Promise<Result>,
    argument: Argument,
  ): Promise<Result>;
  waitForFunction<Argument>(
    pageFunction: (argument: Argument) => boolean,
    argument: Argument,
    options: { polling: "raf" },
  ): Promise<unknown>;
  locator(selector: string): DeckupPngLocator;
}

/** @internal Test seam; not exported from the package index. */
export interface DeckupPngBrowser {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<DeckupPngPage>;
  close(): Promise<void>;
}

/** @internal Test seam; not exported from the package index. */
export interface DeckupPngExportOperations {
  createDeckupAstroConfig: typeof createDeckupAstroConfig;
  build: typeof build;
  readDeckSource(filePath: string): Promise<string>;
  removePngOutputDirectory(outputDir: string): Promise<void>;
  serveStaticExportOutDir(outDir: string): Promise<{ url: string; close(): Promise<void> }>;
  launchBrowser(options: DeckupBrowserOptions): Promise<DeckupPngBrowser>;
}

type DeckupMarkdownConfig = NonNullable<AstroInlineConfig["markdown"]>;

const require = createRequire(import.meta.url);
const astroPackageRoot = dirname(require.resolve("astro/package.json"));
const requiredOptimizeDepsExclude = ["aria-query", "axobject-query", "html-escaper"];

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeAliasEntries(alias: unknown) {
  if (alias === undefined) {
    return [];
  }
  if (Array.isArray(alias)) {
    return alias;
  }
  if (typeof alias === "object" && alias !== null) {
    return Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));
  }
  return [];
}

export function normalizeBuildOutDir(projectRoot: string, outDir = DEFAULT_BUILD_OUT_DIR) {
  return resolve(projectRoot, outDir);
}

function defaultExportOutFile(deck: DeckupResolvedDeck) {
  return `${basename(deck.filePath, extname(deck.filePath))}.pdf`;
}

export function normalizeExportOutFile(
  projectRoot: string,
  deck: DeckupResolvedDeck,
  out = defaultExportOutFile(deck),
) {
  return resolve(projectRoot, out);
}

async function resolveRuntimeDeckupTheme(
  projectRoot: string,
  theme: unknown,
  sourceDeck?: DeckupResolvedDeck,
) {
  try {
    return await resolveDeckupThemeLayouts(projectRoot, theme);
  } catch (error) {
    if (sourceDeck?.metadata?.theme !== undefined) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid Deckup theme metadata in ${sourceDeck.projectRelativePath}: ${message}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

function effectiveThemeInput(deck: DeckupResolvedDeck, deckupConfig: DeckupConfig) {
  return deck.metadata?.theme ?? deckupConfig.theme;
}

async function writeGeneratedPageComponent(
  paths: DeckupRuntimePaths,
  deckupTheme: DeckupResolvedTheme,
): Promise<DeckupRuntimePaths> {
  if (!deckupTheme.layouts?.length) return paths;
  const generatedPageFilePath = join(paths.runtimeOutDir, "generated", "Page.astro");
  await mkdir(dirname(generatedPageFilePath), { recursive: true });
  await writeFile(
    generatedPageFilePath,
    createGeneratedPageComponentSource(
      deckupTheme.slotNames ?? [],
      VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
      deckupTheme.name,
    ),
  );
  return { ...paths, generatedPageFilePath };
}

function createMdxIntegration(deck?: DeckupResolvedDeck) {
  if (!deck) {
    return mdx();
  }

  return mdx({
    processor: unified({
      remarkPlugins: [[remarkDeckupMdxPages, { deckFile: deck.filePath }] as never],
    }),
  });
}

export function createMarkdownConfig(
  markdown: AstroInlineConfig["markdown"] | undefined,
): DeckupMarkdownConfig {
  return {
    syntaxHighlight: "shiki",
    ...markdown,
    shikiConfig: {
      ...markdown?.shikiConfig,
    },
  } satisfies DeckupMarkdownConfig;
}

export function resolveRawAstroCodeHighlightOptions(
  markdown: DeckupMarkdownConfig,
): RawAstroCodeHighlightOptions {
  if (markdown.syntaxHighlight === false || markdown.syntaxHighlight === "prism") {
    return { enabled: false };
  }
  const theme = markdown.shikiConfig?.theme;
  return {
    enabled: true,
    theme: typeof theme === "string" ? theme : DEFAULT_CODE_HIGHLIGHT_THEME,
  };
}

function isInsideDirectory(rootDir: string, filePath: string) {
  const relativePath = relative(rootDir, filePath);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function serveStaticExportOutDir(outDir: string) {
  const rootDir = await realpath(outDir);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(
        requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname,
      );
      const filePath = resolve(rootDir, `.${pathname}`);

      if (!isInsideDirectory(rootDir, filePath)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }

      response.writeHead(200, { "content-type": contentType(filePath) });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      response
        .writeHead(code === "ENOENT" ? 404 : 500)
        .end(code === "ENOENT" ? "Not found" : "Server error");
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (typeof address === "string" || address === null) {
    server.close();
    throw new Error("Failed to start Deckup export static server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

export function createAstroInlineConfig(
  paths: DeckupRuntimePaths,
  options: DeckupDevOptions | DeckupBuildOptions | DeckupExportOptions = {},
  deckupConfig: DeckupConfig = {},
  deck?: DeckupResolvedDeck,
  deckupTheme?: DeckupResolvedTheme,
): AstroInlineConfig {
  return createAstroInlineConfigWithBuiltIns(
    paths,
    options,
    deckupConfig,
    deck,
    deckupTheme,
    resolveDeckupBuiltInIntegrations(paths, deckupConfig),
  );
}

/** @internal Test seam; not exported from the package index. */
export function createAstroInlineConfigWithBuiltIns(
  paths: DeckupRuntimePaths,
  options: DeckupDevOptions | DeckupBuildOptions | DeckupExportOptions,
  deckupConfig: DeckupConfig,
  deck: DeckupResolvedDeck | undefined,
  deckupTheme: DeckupResolvedTheme | undefined,
  builtInIntegrations: DeckupResolvedBuiltInIntegrations,
): AstroInlineConfig {
  const devOptions = options as DeckupDevOptions;
  const buildOptions = options as DeckupBuildOptions;
  const userAstroConfig = deckupConfig.astro ?? {};
  const userMarkdownConfig = userAstroConfig.markdown;
  const markdownConfig = createMarkdownConfig(userMarkdownConfig);
  const userViteConfig = { ...userAstroConfig.vite };
  delete (userViteConfig as { root?: unknown }).root;
  const userViteServer = userViteConfig.server ?? {};
  const userViteFs = userViteServer.fs ?? {};
  const requiredAliases = [
    ...builtInIntegrations.requiredAliases,
    {
      find: /^astro\/app$/,
      replacement: `${astroPackageRoot}/dist/core/app/entrypoints/index.js`,
    },
    {
      find: /^astro\/compiler-runtime$/,
      replacement: `${astroPackageRoot}/dist/runtime/compiler/index.js`,
    },
    {
      find: /^astro\/entrypoints\/(.+)$/,
      replacement: `${astroPackageRoot}/dist/entrypoints/$1.js`,
    },
    {
      find: /^astro\/errors$/,
      replacement: `${astroPackageRoot}/dist/core/errors/userError.js`,
    },
    { find: /^astro\/jsx-runtime$/, replacement: `${astroPackageRoot}/dist/jsx-runtime/index.js` },
    { find: /^astro\/runtime\/(.+)$/, replacement: `${astroPackageRoot}/dist/runtime/$1` },
    { find: /^astro$/, replacement: `${astroPackageRoot}/dist/index.js` },
  ];
  const requiredFsAllow = [
    paths.projectRoot,
    paths.runtimeOutDir,
    ...(deck ? [dirname(deck.filePath)] : []),
    ...(deckupTheme?.filePath ? [dirname(deckupTheme.filePath)] : []),
    ...(deckupTheme?.layoutsDir ? [deckupTheme.layoutsDir] : []),
  ];

  return {
    ...userAstroConfig,
    root: paths.projectRoot,
    outDir: normalizeBuildOutDir(paths.projectRoot, buildOptions.outDir),
    configFile: false,
    devToolbar: { enabled: false },
    output: "static",
    logLevel: options.logLevel ?? "info",
    markdown: markdownConfig,
    integrations: [createMdxIntegration(deck), ...toArray(userAstroConfig.integrations as never)],
    server: {
      host: devOptions.host ?? DEFAULT_DEV_HOST,
      port: devOptions.port ?? deckupConfig.port ?? DEFAULT_DEV_PORT,
      open: devOptions.open ?? false,
    },
    vite: {
      ...userViteConfig,
      plugins: [...builtInIntegrations.vitePlugins, ...toArray(userViteConfig.plugins as never)],
      optimizeDeps: {
        ...userViteConfig.optimizeDeps,
        exclude: uniqueStrings([
          ...requiredOptimizeDepsExclude,
          ...toArray(userViteConfig.optimizeDeps?.exclude),
        ]),
      },
      resolve: {
        ...userViteConfig.resolve,
        alias: [...requiredAliases, ...normalizeAliasEntries(userViteConfig.resolve?.alias)],
      },
      server: {
        ...userViteServer,
        fs: {
          ...userViteFs,
          allow: uniqueStrings([...requiredFsAllow, ...toArray(userViteFs.allow)]),
          strict: true,
        },
      },
    },
  } as AstroInlineConfig;
}

export interface DeckupBuiltInIntegrationOperations {
  resolveBuiltInIntegrations: typeof resolveDeckupBuiltInIntegrations;
  writeBuiltInIntegrationAssets: typeof writeDeckupBuiltInIntegrationAssets;
}

const defaultBuiltInIntegrationOperations: DeckupBuiltInIntegrationOperations = {
  resolveBuiltInIntegrations: resolveDeckupBuiltInIntegrations,
  writeBuiltInIntegrationAssets: writeDeckupBuiltInIntegrationAssets,
};

export async function createDeckupAstroConfig(
  options: DeckupDevOptions | DeckupBuildOptions | DeckupExportOptions = {},
): Promise<DeckupResolvedConfig> {
  return createDeckupAstroConfigWithOperations(options, defaultBuiltInIntegrationOperations);
}

/** @internal Test seam; not exported from the package index. */
export async function createDeckupAstroConfigWithOperations(
  options: DeckupDevOptions | DeckupBuildOptions | DeckupExportOptions,
  builtInIntegrationOperations: DeckupBuiltInIntegrationOperations,
): Promise<DeckupResolvedConfig> {
  const projectRoot = await realpath(resolveProjectRoot(options.root));
  const deck = await resolveDeckFile(projectRoot, options.deckFile);
  const workDir = join(projectRoot, ".deckup");
  await rm(workDir, { force: true, recursive: true });
  await mkdir(workDir, { recursive: true });

  const loadedConfig = await loadDeckupConfig(projectRoot);
  const deckupConfig = resolveDeckupConfig(loadedConfig.config, options);
  const deckThemeSelected = deck.metadata?.theme !== undefined;
  const deckupTheme = await resolveRuntimeDeckupTheme(
    projectRoot,
    effectiveThemeInput(deck, deckupConfig),
    deckThemeSelected ? deck : undefined,
  );
  const paths: DeckupRuntimePaths = {
    projectRoot,
    runtimeSourceDir: resolveRuntimeSourceDir(),
    runtimeOutDir: workDir,
  };
  const builtInIntegrations = builtInIntegrationOperations.resolveBuiltInIntegrations(
    paths,
    deckupConfig,
  );
  await builtInIntegrationOperations.writeBuiltInIntegrationAssets(builtInIntegrations);
  const updatedPaths = await writeGeneratedPageComponent(paths, deckupTheme);
  const registry = createSingleDeckRegistry(projectRoot, deck);
  const rawAstroCodeHighlight = resolveRawAstroCodeHighlightOptions(
    createMarkdownConfig(deckupConfig.astro?.markdown),
  );
  const cliIntegration = createDeckupCliIntegration({
    registry,
    theme: deckupTheme,
    generatedPageFilePath: updatedPaths.generatedPageFilePath,
    codeHighlight: rawAstroCodeHighlight,
    additionalCssModuleIds: builtInIntegrations.runtimeCssModuleIds,
  });
  const pageAlias =
    deckupTheme.layouts?.length && updatedPaths.generatedPageFilePath
      ? [{ find: /^@deckup\/astro\/page$/, replacement: updatedPaths.generatedPageFilePath }]
      : [];
  const astroConfig = createAstroInlineConfigWithBuiltIns(
    updatedPaths,
    options,
    deckupConfig,
    deck,
    deckupTheme,
    builtInIntegrations,
  );
  const existingIntegrations = astroConfig.integrations ?? [];
  astroConfig.integrations = [
    ...(Array.isArray(existingIntegrations)
      ? existingIntegrations
      : [existingIntegrations as never]),
    cliIntegration,
  ];
  if (pageAlias.length > 0) {
    const viteConfig = astroConfig.vite ?? {};
    const resolveConfig = viteConfig.resolve ?? {};
    const existingAliases = normalizeAliasEntries(resolveConfig.alias);
    astroConfig.vite = {
      ...viteConfig,
      resolve: { ...resolveConfig, alias: [...pageAlias, ...existingAliases] },
    };
  }

  return {
    paths: updatedPaths,
    deck,
    deckupConfig,
    deckupConfigFile: loadedConfig.filePath,
    deckupTheme,
    astroConfig,
  };
}

export async function startDevServer(options: DeckupDevOptions = {}): Promise<DeckupDevResult> {
  const { astroConfig } = await createDeckupAstroConfig(options);
  const server = await dev(astroConfig);

  return { server, address: server.address };
}

export async function buildDeck(options: DeckupBuildOptions = {}) {
  const { astroConfig } = await createDeckupAstroConfig(options);
  await build(astroConfig);
}

export async function exportDeck(options: DeckupExportOptions = {}): Promise<DeckupExportResult> {
  const { astroConfig, deck, paths } = await createDeckupAstroConfig(options);
  if (!deck) {
    throw new Error("Missing resolved Deckup deck for PDF export.");
  }

  await build(astroConfig);

  const outDir = normalizeBuildOutDir(paths.projectRoot, options.outDir);
  const htmlFile = join(outDir, "index.html");
  const pdfFile = normalizeExportOutFile(paths.projectRoot, deck, options.out);
  await mkdir(dirname(pdfFile), { recursive: true });

  const staticServer = await serveStaticExportOutDir(outDir);
  const url = new URL(staticServer.url);
  url.searchParams.set(DEFAULT_EXPORT_SEARCH_PARAM, DEFAULT_EXPORT_SEARCH_VALUE);

  try {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: await resolveChromiumExecutablePath({
        executablePath: options.browserExecutablePath,
        cacheDir: options.browserCacheDir,
      }),
      headless: true,
    });
    let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
    let printModePrepared = false;

    try {
      page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await page.goto(url.href, { waitUntil: "networkidle" });
      await page.emulateMedia({ media: "print" });
      await page.evaluate(async () => {
        window.dispatchEvent(new Event("beforeprint"));
        await document.fonts?.ready;
      });
      printModePrepared = true;
      await page.pdf({
        path: pdfFile,
        printBackground: true,
        preferCSSPageSize: true,
        width: PDF_SLIDE_WIDTH,
        height: PDF_SLIDE_HEIGHT,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });

      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      printModePrepared = false;
    } finally {
      if (printModePrepared) {
        await page
          ?.evaluate(() => window.dispatchEvent(new Event("afterprint")))
          .catch(() => undefined);
      }
      await browser.close();
    }
  } finally {
    await staticServer.close();
  }

  return { outDir, htmlFile, pdfFile, url: url.href };
}

function countPngDeckPages(deck: DeckupResolvedDeck, source: string) {
  return deck.format === "astro"
    ? countAstroDeckPages(source, deck.filePath)
    : countMdxDeckPages(source);
}

function assertPngSlideDimensions(
  slideNumber: number,
  box: { width: number; height: number } | null,
) {
  if (box?.width !== PNG_SLIDE_WIDTH || box.height !== PNG_SLIDE_HEIGHT) {
    const actual = box ? `${box.width}x${box.height}` : "missing";
    throw new Error(
      `Deckup PNG slide ${slideNumber} must render at ${PNG_SLIDE_WIDTH}x${PNG_SLIDE_HEIGHT}; received ${actual}.`,
    );
  }
}

async function capturePngSlide(page: DeckupPngPage, slideNumber: number, pngFile: string) {
  await page.evaluate((nextSlideNumber) => {
    const nextHash = `#${nextSlideNumber}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, slideNumber);

  await page.waitForFunction(
    (nextSlideNumber) => {
      const slides = Array.from(document.querySelectorAll<HTMLElement>("[data-deckup-slide]"));
      const activeSlides = slides.filter((slide) => slide.hasAttribute("data-active"));
      const target = slides[nextSlideNumber - 1];
      return (
        window.location.hash === `#${nextSlideNumber}` &&
        activeSlides.length === 1 &&
        activeSlides[0] === target &&
        target?.hidden === false &&
        target.getAttribute("aria-hidden") === "false"
      );
    },
    slideNumber,
    { polling: "raf" },
  );
  await page.waitForFunction(
    (nextSlideNumber) => {
      const target =
        document.querySelectorAll<HTMLElement>("[data-deckup-slide]")[nextSlideNumber - 1];
      if (!target) return false;
      const imagesReady = Array.from(target.querySelectorAll<HTMLImageElement>("img")).every(
        (image) => image.complete && image.naturalWidth > 0,
      );
      const mediaReady = Array.from(
        target.querySelectorAll<HTMLMediaElement>("video, audio"),
      ).every((media) => media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
      return imagesReady && mediaReady;
    },
    slideNumber,
    { polling: "raf" },
  );
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolvePaint) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint()));
    });
  }, undefined);

  const slide = page.locator(pngSlideSelector).nth(slideNumber - 1);
  assertPngSlideDimensions(slideNumber, await slide.boundingBox());
  await slide.screenshot({
    path: pngFile,
    type: "png",
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
}

const defaultPngExportOperations: DeckupPngExportOperations = {
  createDeckupAstroConfig,
  build,
  readDeckSource: (filePath) => readFile(filePath, "utf8"),
  removePngOutputDirectory: (outputDir) => rm(outputDir, { force: true, recursive: true }),
  serveStaticExportOutDir,
  async launchBrowser(options) {
    const { chromium } = await import("playwright-core");
    return (await chromium.launch({
      executablePath: await resolveChromiumExecutablePath({
        executablePath: options.browserExecutablePath,
        cacheDir: options.browserCacheDir,
      }),
      headless: true,
    })) as unknown as DeckupPngBrowser;
  },
};

/** @internal Exported for deterministic lifecycle tests; package consumers use exportDeckPng(). */
export async function exportDeckPngWithOperations(
  options: DeckupPngExportOptions,
  operations: DeckupPngExportOperations,
): Promise<DeckupPngExportResult> {
  const { astroConfig, deck, paths } = await operations.createDeckupAstroConfig(options);
  if (!deck) {
    throw new Error("Missing resolved Deckup deck for PNG export.");
  }

  const source = await operations.readDeckSource(deck.filePath);
  const slideNumbers = parsePngSlideSelection(options.slides, countPngDeckPages(deck, source));
  const outDir = normalizeBuildOutDir(paths.projectRoot, options.outDir);
  const htmlFile = join(outDir, "index.html");
  const pngDir = normalizePngOutputDir(paths.projectRoot, deck, options.out);
  const pngFiles = resolvePngFiles(pngDir, slideNumbers);
  await assertSafePngOutputDirectory({
    projectRoot: paths.projectRoot,
    deckFile: deck.filePath,
    stagingDir: outDir,
    outputDir: pngDir,
  });

  await operations.build(astroConfig);
  await assertSafePngOutputDirectory({
    projectRoot: paths.projectRoot,
    deckFile: deck.filePath,
    stagingDir: outDir,
    outputDir: pngDir,
  });
  await operations.removePngOutputDirectory(pngDir);

  try {
    await mkdir(pngDir, { recursive: true });
    const staticServer = await operations.serveStaticExportOutDir(outDir);
    const url = new URL(staticServer.url);

    try {
      const browser = await operations.launchBrowser(options);
      try {
        const page = await browser.newPage({
          viewport: { width: PNG_SLIDE_WIDTH, height: PNG_SLIDE_HEIGHT },
          deviceScaleFactor: 1,
        });
        await page.goto(url.href, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: pngCaptureStyle });
        for (const [index, slideNumber] of slideNumbers.entries()) {
          await capturePngSlide(page, slideNumber, pngFiles[index]);
        }
      } finally {
        await browser.close();
      }
    } finally {
      await staticServer.close();
    }

    return { outDir, htmlFile, pngDir, pngFiles, url: url.href };
  } catch (error) {
    try {
      await operations.removePngOutputDirectory(pngDir);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Deckup PNG export failed and could not clean partial output: ${pngDir}`,
      );
    }
    throw error;
  }
}

export async function exportDeckPng(
  options: DeckupPngExportOptions = {},
): Promise<DeckupPngExportResult> {
  return exportDeckPngWithOperations(options, defaultPngExportOperations);
}
