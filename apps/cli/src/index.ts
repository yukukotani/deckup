export {
  defineConfig,
  findSlidaConfigFiles,
  loadSlidaConfig,
  SLIDA_CONFIG_FILES,
} from "./config.ts";
export { inferDeckFormat, resolveDeckFile, SUPPORTED_DECK_EXTENSIONS } from "./deck.ts";
export {
  buildDeck,
  createAstroInlineConfig,
  createSlidaAstroConfig,
  normalizeBuildOutDir,
} from "./astro.ts";
export { startDevServer } from "./astro.ts";
export {
  BUILTIN_SLIDA_THEME_PACKAGES,
  BUILTIN_SLIDA_THEMES,
  DEFAULT_SLIDA_THEME,
  resolveSlidaTheme,
} from "./theme.ts";
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
  SlidaDeckFormat,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaLoadedConfig,
  SlidaLogLevel,
  SlidaResolvedConfig,
  SlidaResolvedDeck,
  SlidaResolvedTheme,
  SlidaRuntimePaths,
} from "./types.ts";
