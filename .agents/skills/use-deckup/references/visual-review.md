# PNG visual review

## Review loop

1. Build every slide as PNG into a dedicated disposable directory.
2. Open the PNG paths printed to stdout in order, starting with slide one.
3. Record issues by slide number using the checklist below.
4. Edit the deck source, referenced CSS, components, or assets.
5. Re-render changed slides with `--slides`.
6. Open the new images and inspect both the intended changes and any side effects.
7. Re-render and review the complete deck before finishing.

Never edit generated PNGs, `.deckup/`, or `dist/` directly.

## Per-slide checklist

### Rendering

- Confirm that text, images, code, and decoration are not clipped by the 1600×900 frame.
- Check for overlaps, unintended scrolling, and missing content.
- Confirm that images, fonts, and syntax highlighting load correctly.
- Verify that named-slot content appears in the intended region.

### Hierarchy and legibility

- Make the first visual target obvious.
- Create sufficient distinction among the title, key message, and supporting detail.
- Keep body copy and annotations large enough to read.
- Maintain sufficient contrast between the background, text, and figures.
- Keep code line length, line count, and emphasis legible when projected.

### Composition

- Avoid both cramped and excessive spacing.
- Align edges, baselines, columns, and cards intentionally.
- Balance density and visual weight across two-column layouts.
- Use figures to support the message rather than fill empty space.

### Content

- Ensure each slide's claim can be stated in one sentence.
- Make the title describe the content or conclusion precisely.
- Remove bullets or prose that do not earn their space.
- Give metrics clear units, periods, and comparison baselines.
- Add quotation sources, data attribution, and image credits where needed.

## Whole-deck checklist

- Ensure the argument remains clear when reading only the titles.
- Create visual rhythm across cover, section, content, and conclusion slides.
- Keep theme, color, spacing, heading hierarchy, terminology, and punctuation consistent.
- Avoid long, monotonous sequences of nearly identical slide structures.
- Prevent shared elements from shifting unnecessarily between slides.
- End with a clear conclusion or next action.

## Fix priority

1. Rendering failures: clipping, overlap, missing assets, or misplaced slot content
2. Legibility failures: unreadable text, low contrast, or excessive density
3. Content failures: logical gaps, missing context, or unsupported claims
4. Polish issues: alignment, spacing, balance, or consistency

Make small fixes in priority order and verify each round through fresh PNGs instead of redesigning everything at once.
