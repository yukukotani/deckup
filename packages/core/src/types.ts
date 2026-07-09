export type SlidaDeckFormat = "astro" | "mdx";

export type SlidaRouteId = string;

export interface SlidaDeckMetadata {
  theme?: string;
}

export interface SlidaResolvedDeck {
  filePath: string;
  projectRelativePath: string;
  format: SlidaDeckFormat;
  metadata?: SlidaDeckMetadata;
}

export interface SlidaResolvedDeckRoute extends SlidaResolvedDeck {
  sourceGlob: string;
  globBase: string;
  slug: string;
  routePath: string;
  routeId: SlidaRouteId;
  virtualDeckModuleId: string;
  virtualRouteModuleId: string;
}

export interface SlidaDeckRegistry {
  projectRoot: string;
  base: string;
  decks: SlidaResolvedDeckRoute[];
  byFilePath: Map<string, SlidaResolvedDeckRoute>;
  byProjectRelativePath: Map<string, SlidaResolvedDeckRoute>;
  byRoutePath: Map<string, SlidaResolvedDeckRoute>;
  byRouteId: Map<string, SlidaResolvedDeckRoute>;
  matchId(id: string): SlidaResolvedDeckRoute | undefined;
  matchMdxFile(file: { path?: string; history?: string[] }): SlidaResolvedDeckRoute | undefined;
  getByRoutePath(routePath: string): SlidaResolvedDeckRoute | undefined;
  getByRouteId(routeId: string): SlidaResolvedDeckRoute | undefined;
}

export interface SlidaRuntimePaths {
  projectRoot: string;
  runtimeSourceDir: string;
  runtimeOutDir: string;
  generatedPageFilePath?: string;
}

export interface SlidaResolvedThemeLayout {
  id: string;
  filePath: string;
  importPath: string;
  slotNames: string[];
}

export interface SlidaResolvedTheme {
  name: string;
  importPath?: string;
  filePath?: string;
  packageName?: string;
  packageRoot?: string;
  layoutsDir?: string;
  layouts?: SlidaResolvedThemeLayout[];
  slotNames?: string[];
  source: "builtin" | "package";
}

export type RawAstroCodeHighlightOptions = { enabled: true; theme: string } | { enabled: false };

export interface SlidaNpmThemeDownloadRequest {
  spec: string;
  packageName: string;
  cacheDir: string;
}

export interface SlidaNpmThemeOptions {
  /** @internal Slida-managed npm theme cache override for tests and controlled runtimes. */
  cacheDir?: string;
  /** @internal Confirmation hook used before Slida downloads an uncached npm theme. */
  confirmDownload?: (request: SlidaNpmThemeDownloadRequest) => boolean | Promise<boolean>;
}
