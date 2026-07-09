---
title: Deckup documentation
description: Learn how to install Deckup, author Astro-native slide decks, preview them locally, build static HTML, and export PDFs.
---

# Deckup documentation

Deckup is Astro-native slide deck tooling for authoring presentations in `.astro` and `.mdx` files.
It gives you a small CLI for previewing a deck, building a static web version, and exporting a PDF.

## Start here

If you are new to Deckup, follow these pages in order:

1. [Quickstart](./quickstart/) — install the CLI, create your first deck, preview it, build it, and export it.
2. [Deck authoring](./concepts/deck-authoring/) — learn how pages, layouts, and slots work in Astro and MDX decks.

## References

Use the reference section when you need exact command options or configuration details:

- CLI reference — `deckup open` and `deckup build --format html|pdf`.
- Configuration reference — `deckup.config.*`, `defineConfig()`, and the supported Deckup config fields.
- Theme reference — built-in themes, layout IDs, named slots, and npm theme package requirements.

Deckup's documentation focuses on local usage, static builds, and the hosted reference site.
The production docs site is deployed with Cloudflare Workers Static Assets at <https://deckup.yuku.dev/>; deployment guides for user decks, custom branding, and scaffolding commands remain outside this first version.
