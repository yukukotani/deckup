import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import { build, dev, type AstroInlineConfig } from "astro";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveChromiumExecutablePath } from "./browser.ts";
import { loadSlidaConfig, resolveSlidaConfig } from "./config.ts";
import { resolveDeckFile } from "./deck.ts";
import { prepareRuntime, resolveProjectRoot } from "./runtime.ts";
import { remarkSlidaMdxPages } from "./slida-mdx-pages.ts";
import { createSlidaVitePlugins } from "./slida-vite-plugins.ts";
import {
  VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
} from "./theme-layouts.ts";
import { resolveSlidaThemeLayouts } from "./theme.ts";
import type {
  SlidaBuildOptions,
  SlidaConfig,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaExportOptions,
  SlidaExportResult,
  SlidaResolvedConfig,
  SlidaResolvedDeck,
  SlidaResolvedTheme,
  SlidaRuntimePaths,
} from "./types.ts";

export const DEFAULT_DEV_HOST = "127.0.0.1";
export const DEFAULT_DEV_PORT = 4321;
export const DEFAULT_BUILD_OUT_DIR = "dist";
export const DEFAULT_EXPORT_SEARCH_PARAM = "slida-export";
export const DEFAULT_EXPORT_SEARCH_VALUE = "pdf";
export const PDF_SLIDE_WIDTH = "16in";
export const PDF_SLIDE_HEIGHT = "9in";

const require = createRequire(import.meta.url);
const astroPackageRoot = dirname(require.resolve("astro/package.json"));
const requiredOptimizeDepsExclude = ["aria-query", "axobject-query", "html-escaper"];

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
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

function defaultExportOutFile(deck: SlidaResolvedDeck) {
  return `${basename(deck.filePath, extname(deck.filePath))}.pdf`;
}

export function normalizeExportOutFile(
  projectRoot: string,
  deck: SlidaResolvedDeck,
  out = defaultExportOutFile(deck),
) {
  return resolve(projectRoot, out);
}

async function resolveRuntimeSlidaTheme(projectRoot: string, theme: unknown) {
  return resolveSlidaThemeLayouts(projectRoot, theme);
}

async function writeGeneratedPageComponent(
  paths: SlidaRuntimePaths,
  slidaTheme: SlidaResolvedTheme,
): Promise<SlidaRuntimePaths> {
  if (!slidaTheme.layouts?.length) return paths;
  const generatedPageFilePath = join(paths.runtimeOutDir, "generated", "Page.astro");
  await mkdir(dirname(generatedPageFilePath), { recursive: true });
  await writeFile(
    generatedPageFilePath,
    createGeneratedPageComponentSource(slidaTheme.slotNames ?? [], VIRTUAL_SLIDA_THEME_LAYOUTS_ID),
  );
  return { ...paths, generatedPageFilePath };
}

function assertLayoutThemeConfig(paths: SlidaRuntimePaths, slidaTheme?: SlidaResolvedTheme) {
  if (!slidaTheme) return;
  if (!slidaTheme.layouts?.length) {
    throw new Error(
      `Slida theme ${JSON.stringify(slidaTheme.name)} must resolve from layouts/*.astro. Use resolveSlidaThemeLayouts() or createSlidaAstroConfig() instead of a CSS-only theme object.`,
    );
  }
  if (!paths.generatedPageFilePath) {
    throw new Error(
      `Layout Slida theme ${JSON.stringify(slidaTheme.name)} requires a generated Page component. Use createSlidaAstroConfig() or pass paths.generatedPageFilePath when calling createAstroInlineConfig().`,
    );
  }
}

function createMdxIntegration(deck?: SlidaResolvedDeck) {
  if (!deck) {
    return mdx();
  }

  return mdx({
    processor: unified({
      remarkPlugins: [[remarkSlidaMdxPages, { deckFile: deck.filePath }] as never],
    }),
  });
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
    throw new Error("Failed to start Slida export static server.");
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
  paths: SlidaRuntimePaths,
  options: SlidaDevOptions | SlidaBuildOptions | SlidaExportOptions = {},
  slidaConfig: SlidaConfig = {},
  deck?: SlidaResolvedDeck,
  slidaTheme?: SlidaResolvedTheme,
): AstroInlineConfig {
  const devOptions = options as SlidaDevOptions;
  const buildOptions = options as SlidaBuildOptions;
  const userAstroConfig = slidaConfig.astro ?? {};
  const userViteConfig = { ...userAstroConfig.vite };
  delete (userViteConfig as { root?: unknown }).root;
  const userViteServer = userViteConfig.server ?? {};
  const userViteFs = userViteServer.fs ?? {};
  assertLayoutThemeConfig(paths, slidaTheme);
  const slidaVitePlugins = deck
    ? createSlidaVitePlugins(deck, slidaTheme, {
        generatedPageFilePath: paths.generatedPageFilePath,
      })
    : [];
  const slidaPageAlias =
    slidaTheme?.layouts?.length && paths.generatedPageFilePath
      ? [{ find: /^@slida\/cli\/page$/, replacement: paths.generatedPageFilePath }]
      : [];
  const requiredAliases = [
    ...slidaPageAlias,
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
    ...(slidaTheme?.filePath ? [dirname(slidaTheme.filePath)] : []),
    ...(slidaTheme?.layoutsDir ? [slidaTheme.layoutsDir] : []),
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
    integrations: [createMdxIntegration(deck), ...toArray(userAstroConfig.integrations as never)],
    server: {
      host: devOptions.host ?? DEFAULT_DEV_HOST,
      port: devOptions.port ?? slidaConfig.port ?? DEFAULT_DEV_PORT,
      open: devOptions.open ?? false,
    },
    vite: {
      ...userViteConfig,
      plugins: [...slidaVitePlugins, ...toArray(userViteConfig.plugins as never)],
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

export async function createSlidaAstroConfig(
  options: SlidaDevOptions | SlidaBuildOptions | SlidaExportOptions = {},
): Promise<SlidaResolvedConfig> {
  const projectRoot = await realpath(resolveProjectRoot(options.root));
  const deck = await resolveDeckFile(projectRoot, options.deckFile);
  const preparedPaths = await prepareRuntime(projectRoot);
  const loadedConfig = await loadSlidaConfig(preparedPaths.projectRoot);
  const slidaConfig = resolveSlidaConfig(loadedConfig.config, options);
  const slidaTheme = await resolveRuntimeSlidaTheme(preparedPaths.projectRoot, slidaConfig.theme);
  const paths = await writeGeneratedPageComponent(preparedPaths, slidaTheme);
  return {
    paths,
    deck,
    slidaConfig,
    slidaConfigFile: loadedConfig.filePath,
    slidaTheme,
    astroConfig: createAstroInlineConfig(paths, options, slidaConfig, deck, slidaTheme),
  };
}

export async function startDevServer(options: SlidaDevOptions = {}): Promise<SlidaDevResult> {
  const { astroConfig } = await createSlidaAstroConfig(options);
  const server = await dev(astroConfig);

  return { server, address: server.address };
}

export async function buildDeck(options: SlidaBuildOptions = {}) {
  const { astroConfig } = await createSlidaAstroConfig(options);
  await build(astroConfig);
}

export async function exportDeck(options: SlidaExportOptions = {}): Promise<SlidaExportResult> {
  const { astroConfig, deck, paths } = await createSlidaAstroConfig(options);
  if (!deck) {
    throw new Error("Missing resolved Slida deck for PDF export.");
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
