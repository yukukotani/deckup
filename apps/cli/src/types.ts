import type { AddressInfo } from "node:net";
import type { AstroInlineConfig, dev } from "astro";

export type SlidaLogLevel = NonNullable<AstroInlineConfig["logLevel"]>;

export interface SlidaBaseOptions {
  root?: string;
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

export interface SlidaDevResult {
  server: Awaited<ReturnType<typeof dev>>;
  address: AddressInfo;
}

export interface SlidaResolvedConfig {
  paths: SlidaRuntimePaths;
  astroConfig: AstroInlineConfig;
}
