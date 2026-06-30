export const SLIDA_COVER_LAYOUT = "cover";
export const SLIDA_DEFAULT_LAYOUT = "default";
export const SLIDA_LAYOUT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function getDefaultSlidaLayout(pageIndex: number) {
  return pageIndex === 0 ? SLIDA_COVER_LAYOUT : SLIDA_DEFAULT_LAYOUT;
}

export function isValidSlidaLayoutId(layoutId: string) {
  return SLIDA_LAYOUT_ID_PATTERN.test(layoutId);
}

export function assertValidSlidaLayoutId(layoutId: string, context: string) {
  if (!isValidSlidaLayoutId(layoutId)) {
    throw new Error(
      `Invalid Slida layout id ${JSON.stringify(layoutId)} in ${context}. Layout ids must match ${SLIDA_LAYOUT_ID_PATTERN}.`,
    );
  }
}

export function resolveSlidaLayout(
  layoutId: string | undefined,
  pageIndex: number,
  context: string,
) {
  const resolvedLayout = layoutId ?? getDefaultSlidaLayout(pageIndex);
  assertValidSlidaLayoutId(resolvedLayout, context);
  return resolvedLayout;
}
