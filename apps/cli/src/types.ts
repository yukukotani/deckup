import type { AddressInfo } from "node:net";
import type { AstroInlineConfig, dev } from "astro";

export type SlidaLogLevel = NonNullable<AstroInlineConfig["logLevel"]>;
export type SlidaAstroConfig = Omit<
  AstroInlineConfig,
  "root" | "srcDir" | "configFile" | "output" | "server" | "outDir" | "logLevel" | "devToolbar"
>;
export type SlidaDeckFormat = "astro" | "mdx";

export interface SlidaConfig {
  port?: number;
  theme?: string;
  astro?: SlidaAstroConfig;
}

export interface SlidaLoadedConfig {
  config: SlidaConfig;
  filePath?: string;
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

export interface SlidaRuntimePaths {
  projectRoot: string;
  runtimeSourceDir: string;
  runtimeOutDir: string;
}

export interface SlidaResolvedTheme {
  name: string;
  importPath: string;
  filePath?: string;
  source: "builtin" | "package";
}

export interface SlidaResolvedDeck {
  filePath: string;
  projectRelativePath: string;
  format: SlidaDeckFormat;
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
