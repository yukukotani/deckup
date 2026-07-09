export {
  SUPPORTED_DECK_EXTENSIONS,
  VIRTUAL_DECKUP_DECK_PREFIX,
  VIRTUAL_DECKUP_ROUTE_PREFIX,
  createDeckRegistry,
  inferDeckFormat,
  normalizeDeckupBasePath,
  resolveDeckFile,
  resolveDeckFilesFromGlob,
  resolveDeckRegistry,
} from "@deckup/core";
export type {
  DeckupDeckFormat,
  DeckupDeckRegistry,
  DeckupResolvedDeck,
  DeckupResolvedDeckRoute,
  DeckupRouteId,
} from "@deckup/core";
