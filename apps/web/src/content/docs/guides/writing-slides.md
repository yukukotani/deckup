---
title: Writing Slides
description: Choose an authoring format, organize pages, embed Astro components, and review a Deckup presentation.
---

A Deckup deck is a single `.mdx` or `.astro` file.
Both formats use the same pages, layouts, slots, themes, and export commands.

## Choose MDX or Astro

Use **MDX** for Markdown-first presentations with a small amount of JSX.
Horizontal rules divide the file into slides, so the narrative remains easy to scan and rearrange.

Use **Astro** when the deck needs imported components, custom markup, or more explicit control.
Each top-level `<Page>` component represents one slide.

## Build one idea per page

Start with a short outline, then turn each point into a page.
Prefer a clear title and one visual argument over several unrelated blocks.
The source order is the presentation order.

In MDX, separate pages with `---`:

```mdx
# Quarterly review

What changed and what comes next.

---

# Adoption doubled

- 2× active teams
- 38% faster onboarding
```

In Astro, write top-level `Page` components:

```astro
---
import Page from "@deckup/astro/page";
---

<Page title="Quarterly review">
  <h1>Quarterly review</h1>
  <p>What changed and what comes next.</p>
</Page>
```

## Build a visual with an Astro component

Keep reusable visual markup under `slides/components/`.
For example, create `slides/components/ArchitectureDiagram.astro`:

```astro
<figure aria-label="Application architecture">
  <div>Data source</div>
  <svg viewBox="0 0 120 20" aria-hidden="true">
    <path d="M10 10 H110" stroke="currentColor" />
  </svg>
  <div>Published slide</div>
</figure>
```

Import the component in the deck frontmatter and render it inside a `Page`:

```astro
---
import Page from "@deckup/astro/page";
import ArchitectureDiagram from "./components/ArchitectureDiagram.astro";
---

<Page title="Application architecture" layout="page">
  <h1>Application architecture</h1>
  <ArchitectureDiagram />
</Page>
```

Preview the Astro deck:

```bash
npx deckup open slides/deck.astro
```

Open the [live Astro component slide](/slides/component-showcase#1) to see the same pattern rendered as a richer HTML/CSS/SVG diagram.
For hydrated controls, continue with the [React integration](/integrations/react/) or [Vue integration](/integrations/vue/).

## Apply layouts intentionally

Deckup uses `cover` for the first page and `default` for later pages unless you select another layout.
In Astro, set a static `layout` prop directly on `Page`:

```astro
<Page title="Two perspectives" layout="two-column">
  <h1>Two perspectives</h1>
  <p slot="left">What users need</p>
  <p slot="right">What we will build</p>
</Page>
```

In MDX, add an import-free `PageMeta` declaration as the page's first meaningful item:

```mdx
<PageMeta layout="two-column" />

# Two perspectives

<p slot="left">What users need</p>
<p slot="right">What we will build</p>
```

Layout IDs and named slots come from the selected theme.
Use [Theme](/references/theme/) to compare built-in options and [Syntax](/references/syntax/) for exact declaration rules.

## Preview and revise

Keep the local viewer open while editing:

```bash
npx deckup open slides/deck.mdx
```

Before sharing, render the entire deck to PNG and inspect it in order:

```bash
npx deckup build slides/deck.mdx --format png --out /tmp/deck-review
```

Look for overflow, abrupt density changes, weak contrast, inconsistent alignment, and repeated layouts that flatten the rhythm of the presentation.
