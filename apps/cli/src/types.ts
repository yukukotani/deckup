import type { AddressInfo } from "node:net";
import type { SlidaResolvedDeck, SlidaResolvedTheme, SlidaRuntimePaths } from "@slida/core";
import type { AstroInlineConfig, dev } from "astro";

export type {
  RawAstroCodeHighlightOptions,
  SlidaDeckFormat,
  SlidaDeckRegistry,
  SlidaResolvedDeck,
  SlidaResolvedDeckRoute,
  SlidaResolvedTheme,
  SlidaResolvedThemeLayout,
  SlidaRouteId,
  SlidaRuntimePaths,
} from "@slida/core";

export type SlidaLogLevel = NonNullable<AstroInlineConfig["logLevel"]>;
export type SlidaAstroConfig = Omit<
  AstroInlineConfig,
  "root" | "srcDir" | "configFile" | "output" | "server" | "outDir" | "logLevel" | "devToolbar"
>;
export type SlidaOutputFormat = "html" | "pdf";

export interface SlidaConfig {
  port?: number;
  theme?: string;
  astro?: SlidaAstroConfig;
}

export interface SlidaLoadedConfig {
  config: SlidaConfig;
  filePath?: string;
}

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

export interface SlidaBaseOptions {
  root?: string;
  deckFile?: string;
  logLevel?: SlidaLogLevel;
}

export interface SlidaDevOptions extends SlidaBaseOptions {
  host?: string | boolean;
  port?: number;
  open?: string | boolean;
}

export interface SlidaBuildOptions extends SlidaBaseOptions {
  outDir?: string;
}

export interface SlidaExportOptions extends SlidaBuildOptions {
  out?: string;
  browserExecutablePath?: string;
  browserCacheDir?: string;
}

export interface SlidaBuildCommandOptions extends SlidaExportOptions {
  format: SlidaOutputFormat;
  force: boolean;
}

export interface SlidaExportResult {
  outDir: string;
  htmlFile: string;
  pdfFile: string;
  url: string;
}

export interface SlidaDevResult {
  server: Awaited<ReturnType<typeof dev>>;
  address: AddressInfo;
}

export interface SlidaResolvedConfig {
  paths: SlidaRuntimePaths;
  astroConfig: AstroInlineConfig;
  deck?: SlidaResolvedDeck;
  slidaConfig?: SlidaConfig;
  slidaConfigFile?: string;
  slidaTheme?: SlidaResolvedTheme;
}
