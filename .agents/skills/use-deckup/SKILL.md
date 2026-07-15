---
name: use-deckup
description: Create, edit, design, preview, visually review, and build slide decks or presentations with Deckup using `npx deckup`. Use when working on Deckup `.mdx` or `.astro` decks anywhere inside a project, `deckup.config.*`, Deckup themes and layouts, 1600×900 PNG slide previews, static HTML output, or PDF exports.
---

# Use Deckup

Author Deckup presentations with valid syntax, choose the workflow that matches the task, and verify rendered output before finishing.

## Choose the workflow

1. For a new presentation, read and follow [references/create-deck.md](references/create-deck.md).
2. For changes to an existing presentation, read and follow [references/edit-deck.md](references/edit-deck.md).
3. If the request contains both, apply the editing workflow to the existing deck and the creation workflow only to genuinely new decks.

## Load supporting references

- Read [references/syntax.md](references/syntax.md) before authoring or changing `.mdx`, `.astro`, `deckup.config.*`, layouts, slots, styling, or themes.
- Read [references/cli.md](references/cli.md) before running Deckup commands, selecting output paths, inspecting a theme, or troubleshooting the CLI.
- Read [references/visual-review.md](references/visual-review.md) before judging or improving rendered slides.
- Copy [assets/starter-deck.mdx](assets/starter-deck.mdx) only when creating a new MDX deck that benefits from its structure. Replace all placeholders; never use it to overwrite an existing deck.

## Apply these rules in every workflow

- Treat source decks, referenced components, CSS, assets, and `deckup.config.*` as editable inputs. Never edit generated `.deckup/`, `.astro/`, `dist/`, HTML, PDF, or PNG output to fix the source.
- Resolve the active theme from the target deck's metadata first, then project configuration, then the `default` fallback. Inspect that theme's real layouts and slots instead of guessing them.
- Keep one primary message per slide and do not invent unsupported facts, metrics, quotes, or citations.
- Use a dedicated disposable PNG directory because Deckup replaces an accepted PNG output directory in full.
- Never claim visual review without opening the rendered images. If image viewing is unavailable, state that limitation.
- Report changed source paths, commands and results, reviewed slide numbers, final output paths, and remaining limitations.
