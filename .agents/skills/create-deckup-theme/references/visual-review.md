# Deckup theme visual review

## Prepare a representative deck

Exercise the theme as a system, not as isolated CSS. Include:

- cover with a long title and subtitle;
- default and page layouts with prose, a list, inline code, and a code block;
- section and statement with short focal text;
- number with a large value and explanation;
- quote with attribution;
- two-column with unequal text lengths, lists, and headings in both named slots;
- an image with meaningful alternative text when image styling is supported;
- the longest realistic word, URL, code line, and heading the intended audience will use.

Copy `assets/theme-preview.mdx` as a starting point, replace `THEME_PACKAGE_NAME`, and adapt it to the actual public layout set and audience.

## Render

Use a disposable output directory because Deckup may replace accepted output directories:

```bash
PREVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deckup-theme-preview.XXXXXX")"
npx deckup build slides/theme-preview.mdx \
  --format png \
  --out "$PREVIEW_DIR"
```

Open every 1600×900 output image. After a fix, render only affected one-based slide numbers:

```bash
npx deckup build slides/theme-preview.mdx \
  --format png \
  --slides 2,5-7 \
  --out "$PREVIEW_DIR"
```

## Review each slide

### Fit and resilience

- No text, decoration, image, code, or slot content is clipped.
- Long content wraps or scrolls only where the design deliberately allows it.
- Grid and flex children can shrink; columns do not overflow their tracks.
- Decorative layers cannot obscure content or intercept interaction.

### Hierarchy and typography

- The main message is identifiable at a glance.
- Heading, body, caption, quote, metric, and code styles are distinct.
- Line length and line height remain readable at presentation distance.
- Font fallback does not materially break spacing or wrapping.
- Numeric content uses appropriate alignment and stable figures when useful.

### Composition

- Padding and alignment form a consistent system across layouts.
- Visual weight is balanced without centering every layout by default.
- Two-column regions remain distinct and neither side feels accidentally secondary.
- Repeated accents, borders, radii, and shadows are intentional and consistent.

### Color and accessibility

- Text and controls have sufficient contrast against every background.
- Meaning does not depend on color alone.
- Links, code, emphasis, and focus states remain distinguishable.
- Light/dark behavior matches the declared theme behavior; do not add an accidental dark mode through inherited `color-scheme`.

### Theme identity

- The theme has a clear, coherent visual premise suited to its audience.
- Layout variation comes from content needs, not arbitrary decoration.
- The design does not merely recolor an existing theme when a new identity was requested.
- Runtime navigation visually belongs with the theme variables.

### Slot and layout semantics

- Every named-slot element appears in the intended region.
- Default-slot headings do not land inside a named-slot column accidentally.
- Implicit slide 1 uses `cover`; implicit later slides use `default`.
- Content-order-dependent layouts style the intended first and second elements.

## Review non-PNG output

Build HTML and navigate through all slides. Check keyboard navigation, URL hash changes, and development refresh after source edits. Build PDF when it is a deliverable or when print CSS may affect the theme.

Do not report a theme as visually reviewed unless every rendered preview image was actually opened. Record skipped layouts and unavailable output formats.
