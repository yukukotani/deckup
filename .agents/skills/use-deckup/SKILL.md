---
name: use-deckup
description: Create, edit, design, preview, visually review, and build slide decks or presentations with Deckup using `npx deckup`. Use when working on Deckup `.mdx` or `.astro` decks, files under `slides/`, `deckup.config.*`, Deckup themes and layouts, 1600×900 PNG slide previews, static HTML output, or PDF exports.
---

# Use Deckup

Create decks with valid Deckup syntax, improve them through direct PNG review, and build the requested output formats.

## Read the relevant references

- Read [references/authoring.md](references/authoring.md) when creating a deck, changing syntax, or selecting themes and layouts.
- Read [references/cli.md](references/cli.md) when running commands, choosing output paths, or troubleshooting.
- Read [references/visual-review.md](references/visual-review.md) when evaluating and improving PNG previews.
- Copy [assets/starter-deck.mdx](assets/starter-deck.mdx) only when a new MDX deck benefits from a starter structure, then replace its placeholder content.

## Workflow

### 1. Inspect the project and requirements

1. Read repository instructions and inspect existing `slides/**/*.{mdx,astro}`, `deckup.config.*`, and related images, CSS, and components.
2. When editing an existing deck, preserve its file format, theme, voice, and visual language unless the request explicitly calls for a change.
3. For a new deck, choose `.mdx` for conventional text-led slides and `.astro` when Astro components or precise markup control are required. Place it at `slides/<name>.mdx` by default.
4. Derive the purpose, audience, central conclusion, expected duration, and required output formats from the request. Ask only when missing information would materially affect the result; otherwise make reasonable assumptions.

### 2. Design the narrative

1. Structure the deck as introduction → problem or context → evidence and development → conclusion and next action.
2. Keep one message per slide and make the argument understandable from the slide titles alone.
3. Select layouts based on content rather than decoration.
4. Do not invent unsupported numbers, quotes, or examples. Include sources on the slide or in the format requested by the user when attribution is needed.

### 3. Author with Deckup syntax

1. Follow the syntax constraints and theme-specific layouts in [references/authoring.md](references/authoring.md).
2. Prefer the theme's standard layouts, typography, and spacing. Add only the minimum custom CSS necessary.
3. Establish clear visual hierarchy among headings, body copy, lists, code, and figures. Edit prose down for presentation use instead of pasting long passages.
4. Give meaningful alternative text to images and maintain sufficient contrast with the background. Confirm through a build that external assets such as images and fonts resolve correctly.
5. Do not guess at unsupported syntax or features. Follow established examples in the project or Deckup's documented public syntax.

### 4. Render and review PNGs

Use a dedicated disposable directory. Deckup replaces an accepted PNG output directory in full, so never point it at a directory containing files that must be preserved.

```bash
npx deckup build slides/deck.mdx --format png --out /tmp/deckup-preview
```

1. Render all slides on the first pass. Open each absolute path printed to stdout with an image-viewing tool, in order. In pi, use `view_image`.
2. Apply the criteria in [references/visual-review.md](references/visual-review.md) to inspect clipping, overlap, density, hierarchy, alignment, contrast, consistency, and narrative flow.
3. Fix issues in the source. Do not edit generated PNGs, `.deckup/`, or `dist/` directly.
4. Re-render only the changed slides using one-based slide numbers.

```bash
npx deckup build slides/deck.mdx --format png --slides 2,4-6 --out /tmp/deckup-preview
```

5. Open the new PNGs and verify that each issue is resolved. Repeat until no significant visual issues remain.

Never report a deck as visually reviewed without opening the rendered images. If image viewing is unavailable, state that limitation and provide the generated PNG paths.

### 5. Build final outputs

Build only the formats the user needs.

```bash
# PDF; the default build format
npx deckup build slides/deck.mdx --format pdf --out deck.pdf --force

# Static HTML and assets
npx deckup build slides/deck.mdx --format html --out public-deck
```

Use `--force` only when overwriting an existing PDF non-interactively.

### 6. Report completion

- List the changed deck, configuration, and asset paths.
- Report the `npx deckup` commands run and their results.
- State which PNGs were visually reviewed and summarize the main improvements.
- Provide the final HTML, PDF, or PNG output paths.
- Disclose any unverified areas or remaining limitations.
