export {
  SUPPORTED_DECK_EXTENSIONS,
  VIRTUAL_DECKUP_DECK_PREFIX,
  VIRTUAL_DECKUP_ROUTE_PREFIX,
  createDeckRegistry,
  createSingleDeckRegistry,
  inferDeckFormat,
  normalizeDeckupBasePath,
  resolveDeckFile,
  resolveDeckFilesFromGlob,
  resolveDeckRegistry,
} from "./deck.ts";
export { createDeckLayoutSource } from "./deck-layout.ts";
export {
  DECKUP_COVER_LAYOUT,
  DECKUP_DEFAULT_LAYOUT,
  DECKUP_LAYOUT_ID_PATTERN,
  assertValidDeckupLayoutId,
  getDefaultDeckupLayout,
  isValidDeckupLayoutId,
  resolveDeckupLayout,
} from "./layout.ts";
export {
  findAstroRoot,
  getAttribute,
  getAttributeName,
  getIdentifierName,
  isJsxElementNamed,
} from "./astro-ast.ts";
export {
  analyzeMdxDeckMetadata,
  analyzeMdxDeckSource,
  countMdxDeckPages,
  remarkDeckupMdxPages,
  splitMdxChildrenIntoPages,
  stripMdxFrontmatter,
} from "./deckup-mdx-pages.ts";
export {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  createGeneratedThemePageComponentSource,
  createThemeLayoutsModuleId,
  createThemeLayoutDiscoveryCache,
  discoverThemeLayouts,
  extractAstroSlotNames,
  parseThemeLayoutsModuleId,
  toViteFsImportPath,
} from "./theme-layouts.ts";
export {
  VIRTUAL_DECKUP_DECK_ID,
  analyzeAstroDeckMetadata,
  analyzeAstroDeckSourceForTests,
  collectStaticAstroCodeBlocksForTests,
  countAstroDeckPages,
  createDeckupVitePluginsForRegistry,
  createSourceIndexConverter,
  transformAstroDeckSource,
  transformAstroDeckSourceWithCodeHighlighting,
  validateAstroDeckSource,
} from "./deckup-vite-plugins.ts";
export { DEFAULT_DECK_LAYOUT_MODULE_ID, createRuntimePageSource } from "./runtime-page.ts";
export {
  BUILTIN_DECKUP_THEME_PACKAGES,
  BUILTIN_DECKUP_THEMES,
  DEFAULT_DECKUP_THEME,
  resolveDeckupThemeLayouts,
} from "./theme.ts";
export {
  NPM_DECKUP_THEME_PREFIX,
  DECKUP_THEME_CACHE_ENV,
  getNpmThemeCacheEntryDir,
  parseNpmThemeSource,
  resolveCachedNpmThemePackage,
  resolveNpmThemeCacheDir,
} from "./npm-theme.ts";
export { normalizeIdPath, normalizePath, uniqueStrings } from "./utils.ts";
export type {
  AstroAttribute,
  AstroIdentifier,
  AstroImportDeclaration,
  AstroNode,
  AstroRoot,
} from "./astro-ast.ts";
export type { DeckupMdxPagesOptions } from "./deckup-mdx-pages.ts";
export type { DeckLayoutSourceOptions } from "./deck-layout.ts";
export type { RuntimePageSourceOptions } from "./runtime-page.ts";
export type {
  NpmThemeInstallOperations,
  NpmThemeInstallOptions,
  NpmThemePackageManifest,
  DeckupCachedNpmThemePackage,
  DeckupNpmThemeResolveOptions,
  DeckupNpmThemeSource,
} from "./npm-theme.ts";
export type { DeckupThemeForDeck, DeckupVitePluginOptions } from "./deckup-vite-plugins.ts";
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
} from "./types.ts";
