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
  DEFAULT_EXPORT_SEARCH_PARAM,
  DEFAULT_EXPORT_SEARCH_VALUE,
  exportDeck,
  normalizeBuildOutDir,
  normalizeExportOutFile,
} from "./astro.ts";
export { startDevServer } from "./astro.ts";
export {
  BUILTIN_SLIDA_THEME_PACKAGES,
  BUILTIN_SLIDA_THEMES,
  DEFAULT_SLIDA_THEME,
  resolveSlidaThemeLayouts,
} from "./theme.ts";
export {
  VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  discoverThemeLayouts,
  extractAstroSlotNames,
  toViteFsImportPath,
} from "./theme-layouts.ts";
export {
  normalizeBuildValues,
  normalizeDevValues,
  normalizeExportValues,
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
  SlidaExportOptions,
  SlidaExportResult,
  SlidaLoadedConfig,
  SlidaLogLevel,
  SlidaResolvedConfig,
  SlidaResolvedDeck,
  SlidaResolvedTheme,
  SlidaResolvedThemeLayout,
  SlidaRuntimePaths,
} from "./types.ts";
