import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  createDeckupVitePlugins,
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
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveChromiumExecutablePath } from "./browser.ts";
import { loadDeckupConfig, resolveDeckupConfig } from "./config.ts";
import { prepareRuntime, resolveProjectRoot } from "./runtime.ts";
import type {
  DeckupBuildOptions,
  DeckupConfig,
  DeckupDevOptions,
  DeckupDevResult,
  DeckupExportOptions,
  DeckupExportResult,
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
    ),
  );
  return { ...paths, generatedPageFilePath };
}

function assertLayoutThemeConfig(paths: DeckupRuntimePaths, deckupTheme?: DeckupResolvedTheme) {
  if (!deckupTheme) return;
  if (!deckupTheme.layouts?.length) {
    throw new Error(
      `Deckup theme ${JSON.stringify(deckupTheme.name)} must resolve from layouts/*.astro. Use resolveDeckupThemeLayouts() or createDeckupAstroConfig() instead of a CSS-only theme object.`,
    );
  }
  if (!paths.generatedPageFilePath) {
    throw new Error(
      `Layout Deckup theme ${JSON.stringify(deckupTheme.name)} requires a generated Page component. Use createDeckupAstroConfig() or pass paths.generatedPageFilePath when calling createAstroInlineConfig().`,
    );
  }
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
  const devOptions = options as DeckupDevOptions;
  const buildOptions = options as DeckupBuildOptions;
  const userAstroConfig = deckupConfig.astro ?? {};
  const userMarkdownConfig = userAstroConfig.markdown;
  const markdownConfig = createMarkdownConfig(userMarkdownConfig);
  const rawAstroCodeHighlight = resolveRawAstroCodeHighlightOptions(markdownConfig);
  const userViteConfig = { ...userAstroConfig.vite };
  delete (userViteConfig as { root?: unknown }).root;
  const userViteServer = userViteConfig.server ?? {};
  const userViteFs = userViteServer.fs ?? {};
  assertLayoutThemeConfig(paths, deckupTheme);
  const deckupVitePlugins = deck
    ? createDeckupVitePlugins(deck, deckupTheme, {
        generatedPageFilePath: paths.generatedPageFilePath,
        codeHighlight: rawAstroCodeHighlight,
      })
    : [];
  const deckupPageAlias =
    deckupTheme?.layouts?.length && paths.generatedPageFilePath
      ? [{ find: /^@deckup\/astro\/page$/, replacement: paths.generatedPageFilePath }]
      : [];
  const requiredAliases = [
    ...deckupPageAlias,
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
    paths.runtimeSourceDir,
    ...(deck ? [dirname(deck.filePath)] : []),
    ...(deckupTheme?.filePath ? [dirname(deckupTheme.filePath)] : []),
    ...(deckupTheme?.layoutsDir ? [deckupTheme.layoutsDir] : []),
  ];

  const astroConfig = {
    ...userAstroConfig,
    root: paths.projectRoot,
    srcDir: paths.runtimeOutDir,
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
      plugins: [...deckupVitePlugins, ...toArray(userViteConfig.plugins as never)],
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

  return astroConfig;
}

export async function createDeckupAstroConfig(
  options: DeckupDevOptions | DeckupBuildOptions | DeckupExportOptions = {},
): Promise<DeckupResolvedConfig> {
  const projectRoot = await realpath(resolveProjectRoot(options.root));
  const deck = await resolveDeckFile(projectRoot, options.deckFile);
  const preparedPaths = await prepareRuntime(projectRoot);
  const loadedConfig = await loadDeckupConfig(preparedPaths.projectRoot);
  const deckupConfig = resolveDeckupConfig(loadedConfig.config, options);
  const deckThemeSelected = deck.metadata?.theme !== undefined;
  const deckupTheme = await resolveRuntimeDeckupTheme(
    preparedPaths.projectRoot,
    effectiveThemeInput(deck, deckupConfig),
    deckThemeSelected ? deck : undefined,
  );
  const paths = await writeGeneratedPageComponent(preparedPaths, deckupTheme);
  return {
    paths,
    deck,
    deckupConfig,
    deckupConfigFile: loadedConfig.filePath,
    deckupTheme,
    astroConfig: createAstroInlineConfig(paths, options, deckupConfig, deck, deckupTheme),
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
