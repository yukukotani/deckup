---
title: Writing Slides
description: Choose an authoring format, organize pages, apply layouts, and review a Deckup presentation.
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

## Apply layouts intentionally

Deckup uses `cover` for the first page and `default` for later pages unless you add an explicit layout declaration.

```mdx
<layout id="two-column" />

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
