export {
  defineConfig,
  findSlidaConfigFiles,
  loadSlidaConfig,
  SLIDA_CONFIG_FILES,
} from "./config.ts";
export {
  buildDeck,
  createAstroInlineConfig,
  createSlidaAstroConfig,
  normalizeBuildOutDir,
} from "./astro.ts";
export { startDevServer } from "./astro.ts";
export {
  normalizeBuildValues,
  normalizeDevValues,
  normalizeLogLevel,
  runSlida,
} from "./commands.ts";
export {
  pathExists,
  prepareRuntime,
  resolveProjectRoot,
  resolveRuntimeSourceDir,
} from "./runtime.ts";
export type {
  SlidaAstroConfig,
  SlidaBaseOptions,
  SlidaBuildOptions,
  SlidaConfig,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaLoadedConfig,
  SlidaLogLevel,
  SlidaResolvedConfig,
  SlidaRuntimePaths,
} from "./types.ts";
