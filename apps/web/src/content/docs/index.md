---
title: Slida documentation
description: Learn how to install Slida, author Astro-native slide decks, preview them locally, build static HTML, and export PDFs.
---

# Slida documentation

Slida is Astro-native slide deck tooling for authoring presentations in `.astro` and `.mdx` files.
It gives you a small CLI for previewing a deck, building a static web version, and exporting a PDF.

## Start here

If you are new to Slida, follow these pages in order:

1. [Quickstart](./quickstart/) — install the CLI, create your first deck, preview it, build it, and export it.
2. [Deck authoring](./concepts/deck-authoring/) — learn how pages, layouts, and slots work in Astro and MDX decks.

## References

Use the reference section when you need exact command options or configuration details:

- CLI reference — `slida open` and `slida build --format html|pdf`.
- Configuration reference — `slida.config.*`, `defineConfig()`, and the supported Slida config fields.
- Theme reference — built-in themes, layout IDs, named slots, and npm theme package requirements.

Slida's first documentation site intentionally focuses on local usage and static builds.
Deployment targets, custom branding, and scaffolding commands are not part of this first version.
