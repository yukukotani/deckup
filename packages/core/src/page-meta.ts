export const PAGE_META_MARKER_NAME = "PageMeta";

export type NormalizedPageMetaAttribute = {
  name: string | undefined;
  staticStringValue: string | undefined;
};

export function resolvePageMetaLayoutAttribute(
  attributes: readonly NormalizedPageMetaAttribute[],
  context: string,
) {
  if (attributes.length !== 1 || attributes[0]?.name !== "layout") {
    throw new Error(
      `PageMeta declaration in ${context} must have exactly one layout attribute and no other attributes.`,
    );
  }

  const layout = attributes[0].staticStringValue;
  if (layout === undefined) {
    throw new TypeError(
      `PageMeta declaration in ${context} layout attribute must be a static string.`,
    );
  }
  if (layout.trim().length === 0) {
    throw new TypeError(
      `PageMeta declaration in ${context} layout attribute must be a non-empty string.`,
    );
  }
  return layout;
}
