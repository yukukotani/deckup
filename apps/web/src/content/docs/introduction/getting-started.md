---
title: Getting Started
description: Install Deckup, create a deck, preview it, and export HTML, PDF, or PNG files.
---

## Install Deckup

Install Deckup in your presentation project and create a `slides/` directory:

```bash
npm install -D deckup
mkdir -p slides
```

## Create your first deck

Create `slides/deck.mdx`:

```mdx
---
title: My first Deckup deck
---

# My first Deckup deck

An Astro-native presentation.

---

# A content slide

- Write slides in Markdown.
- Start a new slide with a horizontal rule.
- Add layouts when the presentation needs more structure.
```

The first page uses the `cover` layout by default. Later pages use `default`.

## Preview the deck

Start the local preview server:

```bash
npx deckup open slides/deck.mdx --open
```

Use the arrow keys or the on-screen controls to move between slides.

## Export the deck

Build static HTML and assets:

```bash
npx deckup build slides/deck.mdx --format html
```

Export a PDF (the default build format):

```bash
npx deckup build slides/deck.mdx
```

Render every slide as a fixed 1600×900 PNG:

```bash
npx deckup build slides/deck.mdx --format png
```

The default output name comes from the deck filename. Use `--out` to choose another file or directory.

## Next steps

- Read [Writing Slides](/guides/writing-slides/) for a practical authoring workflow.
- Check the [Syntax reference](/references/syntax/) for exact Astro, MDX, layout, and slot rules.
- Compare the [built-in themes](/references/theme/).
