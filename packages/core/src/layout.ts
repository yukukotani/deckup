export const DECKUP_COVER_LAYOUT = "cover";
export const DECKUP_DEFAULT_LAYOUT = "default";
export const DECKUP_LAYOUT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function getDefaultDeckupLayout(pageIndex: number) {
  return pageIndex === 0 ? DECKUP_COVER_LAYOUT : DECKUP_DEFAULT_LAYOUT;
}

export function isValidDeckupLayoutId(layoutId: string) {
  return DECKUP_LAYOUT_ID_PATTERN.test(layoutId);
}

export function assertValidDeckupLayoutId(layoutId: string, context: string) {
  if (!isValidDeckupLayoutId(layoutId)) {
    throw new Error(
      `Invalid Deckup layout id ${JSON.stringify(layoutId)} in ${context}. Layout ids must match ${DECKUP_LAYOUT_ID_PATTERN}.`,
    );
  }
}

export function resolveDeckupLayout(
  layoutId: string | undefined,
  pageIndex: number,
  context: string,
) {
  const resolvedLayout = layoutId ?? getDefaultDeckupLayout(pageIndex);
  assertValidDeckupLayoutId(resolvedLayout, context);
  return resolvedLayout;
}
