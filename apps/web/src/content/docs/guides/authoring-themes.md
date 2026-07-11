---
title: Authoring Themes
description: Build and package reusable Deckup themes as npm packages of Astro layout components.
---

A Deckup theme is an npm package containing Astro components under `layouts/`.
Each component defines one layout that slide authors can select by file name.

## Create the package

A theme package must expose its package metadata and Astro layout files:

```json
{
  "name": "@acme/deckup-theme",
  "type": "module",
  "exports": {
    "./layouts/*.astro": "./layouts/*.astro",
    "./package.json": "./package.json"
  },
  "files": ["layouts"]
}
```

CSS-only package-root themes are not supported.
Import shared styles from the layout components instead.

## Add layouts

A theme must include at least one readable `layouts/*.astro` file.
The filename becomes the layout ID:

- `layouts/default.astro` provides `default`;
- `layouts/cover.astro` provides `cover`;
- `layouts/two-column.astro` provides `two-column`.

Files beginning with `_` are ignored.
Layout IDs must start with a lowercase letter and may contain lowercase letters, numbers, and hyphens.

A minimal layout renders the default slot:

```astro
---
import "../styles/theme.css";
---

<main class="slide">
  <slot />
</main>
```

## Define named regions

Use named Astro slots when a layout has multiple content regions:

```astro
<main class="slide">
  <header><slot /></header>
  <section class="columns">
    <div><slot name="left" /></div>
    <div><slot name="right" /></div>
  </section>
</main>
```

Deckup detects the `left` and `right` names and makes them available to slide authors.

## Test the package locally

Install or link the package in a deck project and use its package specifier:

```ts
import { defineConfig } from "deckup";

export default defineConfig({
  theme: "@acme/deckup-theme",
});
```

Create a fixture deck that exercises every layout and slot, then preview it and render all pages to PNG.
Check long titles, sparse and dense content, code blocks, lists, images, and overflow before publishing.

See the [Theme reference](/references/theme/) for theme selection, precedence, and npm registry resolution.
