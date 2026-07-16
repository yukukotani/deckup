export type DeckupDeckFormat = "astro" | "mdx";

export type DeckupRouteId = string;

export interface DeckupDeckMetadata {
  theme?: string;
}

export interface DeckupResolvedDeck {
  filePath: string;
  projectRelativePath: string;
  format: DeckupDeckFormat;
  metadata?: DeckupDeckMetadata;
}

export interface DeckupResolvedDeckRoute extends DeckupResolvedDeck {
  sourceGlob: string;
  globBase: string;
  slug: string;
  routePath: string;
  routeId: DeckupRouteId;
  virtualDeckModuleId: string;
  virtualRouteModuleId: string;
}

export interface DeckupDeckRegistry {
  projectRoot: string;
  base: string;
  decks: DeckupResolvedDeckRoute[];
  byFilePath: Map<string, DeckupResolvedDeckRoute>;
  byProjectRelativePath: Map<string, DeckupResolvedDeckRoute>;
  byRoutePath: Map<string, DeckupResolvedDeckRoute>;
  byRouteId: Map<string, DeckupResolvedDeckRoute>;
  matchId(id: string): DeckupResolvedDeckRoute | undefined;
  matchMdxFile(file: { path?: string; history?: string[] }): DeckupResolvedDeckRoute | undefined;
  getByRoutePath(routePath: string): DeckupResolvedDeckRoute | undefined;
  getByRouteId(routeId: string): DeckupResolvedDeckRoute | undefined;
}

export interface DeckupRuntimePaths {
  projectRoot: string;
  runtimeSourceDir: string;
  runtimeOutDir: string;
  generatedPageFilePath?: string;
}

export interface DeckupResolvedThemeLayout {
  id: string;
  description?: string;
  filePath: string;
  importPath: string;
  hasDefaultSlot: boolean;
  slotNames: string[];
}

export interface DeckupResolvedTheme {
  name: string;
  description?: string;
  importPath?: string;
  filePath?: string;
  packageName?: string;
  packageRoot?: string;
  layoutsDir?: string;
  layouts?: DeckupResolvedThemeLayout[];
  slotNames?: string[];
  source: "builtin" | "package";
}

export type RawAstroCodeHighlightOptions = { enabled: true; theme: string } | { enabled: false };

export interface DeckupNpmThemeDownloadRequest {
  spec: string;
  packageName: string;
  cacheDir: string;
}

export interface DeckupNpmThemeOptions {
  /** @internal Deckup-managed npm theme cache override for tests and controlled runtimes. */
  cacheDir?: string;
  /** @internal Confirmation hook used before Deckup downloads an uncached npm theme. */
  confirmDownload?: (request: DeckupNpmThemeDownloadRequest) => boolean | Promise<boolean>;
}
