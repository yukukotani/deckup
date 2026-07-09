import type { AddressInfo } from "node:net";
import type { DeckupResolvedDeck, DeckupResolvedTheme, DeckupRuntimePaths } from "@deckup/core";
import type { AstroInlineConfig, dev } from "astro";

export type {
  RawAstroCodeHighlightOptions,
  DeckupDeckFormat,
  DeckupDeckMetadata,
  DeckupDeckRegistry,
  DeckupNpmThemeDownloadRequest,
  DeckupNpmThemeOptions,
  DeckupResolvedDeck,
  DeckupResolvedDeckRoute,
  DeckupResolvedTheme,
  DeckupResolvedThemeLayout,
  DeckupRouteId,
  DeckupRuntimePaths,
} from "@deckup/core";

export type DeckupLogLevel = NonNullable<AstroInlineConfig["logLevel"]>;
export type DeckupAstroConfig = Omit<
  AstroInlineConfig,
  "root" | "srcDir" | "configFile" | "output" | "server" | "outDir" | "logLevel" | "devToolbar"
>;
export type DeckupOutputFormat = "html" | "pdf";

export interface DeckupConfig {
  port?: number;
  theme?: string;
  astro?: DeckupAstroConfig;
}

export interface DeckupLoadedConfig {
  config: DeckupConfig;
  filePath?: string;
}

export interface DeckupBaseOptions {
  root?: string;
  deckFile?: string;
  logLevel?: DeckupLogLevel;
}

export interface DeckupDevOptions extends DeckupBaseOptions {
  host?: string | boolean;
  port?: number;
  open?: string | boolean;
}

export interface DeckupBuildOptions extends DeckupBaseOptions {
  outDir?: string;
}

export interface DeckupExportOptions extends DeckupBuildOptions {
  out?: string;
  browserExecutablePath?: string;
  browserCacheDir?: string;
}

export interface DeckupBuildCommandOptions extends DeckupExportOptions {
  format: DeckupOutputFormat;
  force: boolean;
}

export interface DeckupExportResult {
  outDir: string;
  htmlFile: string;
  pdfFile: string;
  url: string;
}

export interface DeckupDevResult {
  server: Awaited<ReturnType<typeof dev>>;
  address: AddressInfo;
}

export interface DeckupResolvedConfig {
  paths: DeckupRuntimePaths;
  astroConfig: AstroInlineConfig;
  deck?: DeckupResolvedDeck;
  deckupConfig?: DeckupConfig;
  deckupConfigFile?: string;
  deckupTheme?: DeckupResolvedTheme;
}
