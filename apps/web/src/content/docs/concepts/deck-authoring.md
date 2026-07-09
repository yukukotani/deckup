---
title: Deck authoring
description: Learn how Slida turns Astro and MDX files into pages, layouts, and themed slide regions.
---

# Deck authoring

A Slida deck is a single `.astro` or `.mdx` file.
Both formats render pages with the same layout system, but they use different authoring styles.

## Layout defaults

Slida chooses a layout for every page:

- Page 1 defaults to `cover`.
- Page 2 and later default to `default`.
- Explicit layout IDs must start with a lowercase letter and may contain lowercase letters, numbers, and hyphens.

Use an explicit layout when the selected theme provides a layout you want to use:

```mdx
<layout id="default" />
```

## Deck themes

Decks inherit the `theme` from `slida.config.*`.
Individual decks can override that fallback with static theme metadata.

In Astro decks, declare a top-level `theme` constant in the frontmatter script:

```astro
---
import Page from "@slida/astro/page";
const theme = "bold";
---

<Page title="Bold deck">
  <h1>Bold deck</h1>
</Page>
```

In MDX decks, use YAML frontmatter:

```mdx
---
title: Minimal deck
theme: minimal
---

# Minimal deck
```

Slida resolves deck themes as deck metadata first, then `slida.config.*`, then `default`.
The deck theme value must be a static string.

## Astro decks

Astro decks import `Page` and place only top-level `<Page>` components in the file:

```astro
---
import Page from "@slida/astro/page";
---

<Page title="Presentation title">
  <layout id="cover" />
  <h1>Presentation title</h1>
  <p>Presentation subtitle</p>
</Page>

<Page title="Content slide">
  <layout id="default" />
  <h1>Content slide</h1>
  <p>Write slide content with Astro components and HTML.</p>
</Page>
```

The `<layout id="..." />` element is metadata.
It must be a self-closing child of a page and is removed before the slide content is rendered.

## MDX decks

MDX decks are split into pages with horizontal rules:

```mdx
# Cover title

Cover subtitle

---

# Content slide

- Bullet
- Bullet
```

Slida wraps each MDX page in a generated `<Page>` component.
A page may contain at most one `<layout id="..." />` declaration.
Empty pages are not valid, so avoid adjacent horizontal rules and trailing dividers without content.

## Named slots

Themes can expose named slots for multi-region layouts.
For example, the `google-basic` theme includes a `two-column` layout with `left` and `right` slots.
Use Astro's standard `slot` attribute to target those regions:

```astro
<Page title="Two-column slide">
  <layout id="two-column" />
  <h1>Two columns</h1>
  <p slot="left">Left side</p>
  <p slot="right">Right side</p>
</Page>
```

The same slot attributes work in MDX when you use JSX elements:

```mdx
<layout id="two-column" />

# Two columns

<p slot="left">Left side</p>
<p slot="right">Right side</p>
```

Available layout IDs and slot names depend on the selected theme.
