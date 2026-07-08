export {
  SUPPORTED_DECK_EXTENSIONS,
  VIRTUAL_SLIDA_DECK_PREFIX,
  VIRTUAL_SLIDA_ROUTE_PREFIX,
  createDeckRegistry,
  inferDeckFormat,
  normalizeSlidaBasePath,
  resolveDeckFile,
  resolveDeckFilesFromGlob,
  resolveDeckRegistry,
} from "./deck.ts";
export {
  SLIDA_COVER_LAYOUT,
  SLIDA_DEFAULT_LAYOUT,
  SLIDA_LAYOUT_ID_PATTERN,
  assertValidSlidaLayoutId,
  getDefaultSlidaLayout,
  isValidSlidaLayoutId,
  resolveSlidaLayout,
} from "./layout.ts";
export {
  findAstroRoot,
  getAttribute,
  getAttributeName,
  getIdentifierName,
  isJsxElementNamed,
} from "./astro-ast.ts";
export {
  analyzeMdxDeckSource,
  countMdxDeckPages,
  remarkSlidaMdxPages,
  splitMdxChildrenIntoPages,
  stripMdxFrontmatter,
} from "./slida-mdx-pages.ts";
export {
  VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  createThemeLayoutDiscoveryCache,
  discoverThemeLayouts,
  extractAstroSlotNames,
  toViteFsImportPath,
} from "./theme-layouts.ts";
export {
  VIRTUAL_SLIDA_DECK_ID,
  collectStaticAstroCodeBlocksForTests,
  countAstroDeckPages,
  createSlidaVitePlugins,
  createSlidaVitePluginsForRegistry,
  createSourceIndexConverter,
  transformAstroDeckSource,
  transformAstroDeckSourceWithCodeHighlighting,
  transformCompiledAstroDeckSource,
  validateAstroDeckSource,
} from "./slida-vite-plugins.ts";
export { DEFAULT_DECK_LAYOUT_MODULE_ID, createRuntimePageSource } from "./runtime-page.ts";
export { normalizeIdPath, normalizePath, uniqueStrings } from "./utils.ts";
export type {
  AstroAttribute,
  AstroIdentifier,
  AstroImportDeclaration,
  AstroNode,
  AstroRoot,
} from "./astro-ast.ts";
export type { SlidaMdxPagesOptions } from "./slida-mdx-pages.ts";
export type { RuntimePageSourceOptions } from "./runtime-page.ts";
export type { SlidaVitePluginOptions } from "./slida-vite-plugins.ts";
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
} from "./types.ts";
