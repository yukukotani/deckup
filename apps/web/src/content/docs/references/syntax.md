---
title: Syntax
description: Exact syntax rules for Deckup pages, layouts, themes, and named slots in Astro and MDX.
---

## Deck files

A deck is one `.astro` or `.mdx` file.
Both formats produce an ordered list of pages and use the same theme layout system.

## Astro pages

Astro decks import `Page` and contain only top-level `<Page>` components:

```astro
---
import Page from "@deckup/astro/page";
---

<Page title="Presentation title">
  <layout id="cover" />
  <h1>Presentation title</h1>
</Page>

<Page title="Content">
  <p>Slide content</p>
</Page>
```

## MDX pages

Horizontal rules split MDX decks into pages:

```mdx
# Cover title

Cover subtitle

---

# Content slide

- First point
- Second point
```

Deckup wraps each segment in a generated `Page` component.
Empty pages are invalid, so do not use adjacent rules or a trailing rule without content.

## Layout declarations

Deckup assigns `cover` to page 1 and `default` to every later page unless the page declares another layout:

```mdx
<layout id="two-column" />
```

A page may contain at most one declaration.
It must be a self-closing child of the page and is removed before the content renders.
Layout IDs start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.

## Named slots

Target a named region with Astro's standard `slot` attribute:

```astro
<Page title="Two columns">
  <layout id="two-column" />
  <h1>Two columns</h1>
  <p slot="left">Left side</p>
  <p slot="right">Right side</p>
</Page>
```

The same syntax works on JSX elements in MDX.
Available layout IDs and slot names depend on the selected theme.

## Deck-level themes

In MDX, set static theme metadata in YAML frontmatter:

```mdx
---
title: Product update
theme: minimal
---
```

In Astro, declare a static top-level constant in the frontmatter script:

```astro
---
const theme = "minimal";
---
```

The value must be a static string.
Theme precedence is deck metadata, then `deckup.config.*`, then `default`.
