---
title: Quickstart
description: Install Slida from npm, create a small deck, preview it locally, build static HTML, and export a PDF.
---

# Quickstart

This guide shows the intended public npm workflow for Slida.
It assumes `@slida/cli` is available from npm and provides the `slida` binary.

## Install the CLI

Install Slida in your deck project:

```bash
npm install -D @slida/cli
```

Create a `slides/` directory:

```bash
mkdir -p slides
```

## Create a deck

Create `slides/deck.mdx`:

```mdx
---
title: My first Slida deck
---

# My first Slida deck

A slide deck authored with MDX.

---

# A content slide

- Write slides in Markdown.
- Split pages with horizontal rules.
- Add a layout declaration when you need a specific theme layout.
```

MDX decks start a new page at each horizontal rule (`---`).
If you omit a layout declaration, the first page uses the `cover` layout and later pages use the `default` layout.

## Preview the deck

Start the local preview server:

```bash
npx slida dev slides/deck.mdx
```

Use `--host`, `--port` (or `-p`), and `--open` when you need to change the local server behavior:

```bash
npx slida dev slides/deck.mdx --port 4321 --open
```

## Build static HTML

Build the deck as static HTML and assets:

```bash
npx slida build slides/deck.mdx
```

By default, Slida writes the build to `dist/`.
Use `--outDir` to choose a different directory:

```bash
npx slida build slides/deck.mdx --outDir public-deck
```

## Export a PDF

Export the deck to PDF:

```bash
npx slida export slides/deck.mdx
```

The default PDF filename comes from the deck filename, so `slides/deck.mdx` exports `deck.pdf`.
Use `--out` to choose a file and `--force` (or `-f`) to overwrite an existing PDF without an interactive prompt:

```bash
npx slida export slides/deck.mdx --out slides.pdf --force
```

## Next steps

Read [Deck authoring](/concepts/deck-authoring/) to learn the difference between `.astro` and `.mdx` decks, how layouts are selected, and how named slots work.
