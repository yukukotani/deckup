---
title: Quickstart
description: Install Deckup, author and preview a deck, build HTML/PDF, and render slide PNGs for visual review.
---

This guide shows the intended public npm workflow for Deckup.
It assumes `deckup` is available from npm and provides the `deckup` binary.

## Install the CLI

Install Deckup in your deck project:

```bash
npm install -D deckup
```

Create a `slides/` directory:

```bash
mkdir -p slides
```

## Create a deck

Create `slides/deck.mdx`:

```mdx
---
title: My first Deckup deck
---

# My first Deckup deck

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
npx deckup open slides/deck.mdx
```

Use `--host`, `--port` (or `-p`), and `--open` when you need to change the local server behavior:

```bash
npx deckup open slides/deck.mdx --port 4321 --open
```

## Build static HTML

Build the deck as static HTML and assets by selecting the `html` output format:

```bash
npx deckup build slides/deck.mdx --format html
```

The default HTML output directory comes from the deck filename, so `slides/deck.mdx` builds to `deck/`.
Use `--out` to choose a different directory:

```bash
npx deckup build slides/deck.mdx --format html --out public-deck
```

## Render PNGs for visual review

Render every slide as a fixed 1600×900 PNG:

```bash
npx deckup build slides/deck.mdx --format png
```

The default PNG output directory is also `deck/`.
A successful PNG build prints absolute image paths such as `/path/to/project/deck/slide-001.png`, one per line, and the files contain only the slide body without the viewer navigation or border.
Use `--slides` for one-based numbers, comma-separated lists, and inclusive ranges, and use `--out` to choose a directory:

```bash
npx deckup build slides/deck.mdx --format png --slides 1,3-5 --out /tmp/deckup-png
```

Deckup de-duplicates the selection and renders it in deck order.
It validates the complete selection and rejects dangerous output paths before changing the PNG directory.
After a valid build, it replaces the chosen directory in full, so do not point `--out` at a directory containing files you want to keep.
`--force` is unnecessary for PNG and has no effect.

## Export a PDF

Build the deck as a PDF. PDF is the default `deckup build` output format:

```bash
npx deckup build slides/deck.mdx
```

The default PDF filename comes from the deck filename, so `slides/deck.mdx` exports `deck.pdf`.
Use `--out` to choose a file and `--force` (or `-f`) to overwrite an existing PDF without an interactive prompt:

```bash
npx deckup build slides/deck.mdx --format pdf --out slides.pdf --force
```

## Next steps

Read [Deck authoring](/concepts/deck-authoring/) to learn the difference between `.astro` and `.mdx` decks, how layouts are selected, and how named slots work.
