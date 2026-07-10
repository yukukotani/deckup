# Deckup authoring reference

## Choose a format

- Use `.mdx` for Markdown-led decks, quick authoring, and standard layouts.
- Use `.astro` for Astro components, precise HTML, and complex slot content.
- Preserve the format of an existing deck unless there is an explicit reason to change it.

Represent each deck as one `.mdx` or `.astro` file.

## MDX syntax

Set the title and theme in YAML frontmatter, then separate pages with horizontal rules (`---`).

```mdx
---
title: Product update
theme: google-basic
---

# Product update

What changed and why it matters

---

<layout id="page" />

# Three outcomes

- Faster onboarding
- Fewer support requests
- Clearer ownership
```

Constraints:

- Do not create empty pages with adjacent horizontal rules or a trailing divider without content.
- Use at most one `<layout id="..." />` declaration per page.
- Write layout declarations as self-closing elements.
- Use MDX imports and JSX/HTML when needed. Assign named slots through the `slot` attribute on JSX/HTML elements.

## Astro syntax

Default-import `Page` from `@deckup/astro/page` and place only `<Page>` components at the top level of the file.

```astro
---
import Page from "@deckup/astro/page";
const theme = "google-basic";
---

<Page title="Product update">
  <layout id="cover" />
  <h1>Product update</h1>
  <p>What changed and why it matters</p>
</Page>

<Page title="Two priorities">
  <layout id="two-column" />
  <h1>Two priorities</h1>
  <div slot="left">
    <h2>Now</h2>
    <p>Remove the largest blocker.</p>
  </div>
  <div slot="right">
    <h2>Next</h2>
    <p>Scale the proven path.</p>
  </div>
</Page>
```

Constraints:

- Include at least one `<Page>`.
- Place `<layout>` as a direct, self-closing child of `<Page>`.
- Use at most one layout declaration per page.
- Give each page a `title` for an accessible slide name.
- Declare the theme in frontmatter as a static `const theme = "..."` string.

## Layout rules

- The first page defaults to `cover`.
- The second and later pages default to `default`.
- Select a layout explicitly with `<layout id="page" />`.
- Start layout IDs with a lowercase letter and use only lowercase letters, numbers, and hyphens.
- Available layout IDs and named slots depend on the selected theme.

Common uses:

| Layout             | Use                        | Content guidance                                           |
| ------------------ | -------------------------- | ---------------------------------------------------------- |
| `cover`            | Opening slide              | Keep only the title and a short subtitle                   |
| `section`          | Section divider            | Make a short heading the focal point                       |
| `default` / `page` | General content            | Use a heading with concise prose, lists, or code           |
| `two-column`       | Comparison or parallelism  | Balance density between the `left` and `right` slots       |
| `number`           | KPI or important metric    | Put the number in paragraph one and its explanation second |
| `quote`            | Quotation                  | Put the quote in paragraph one and attribution second      |
| `statement`        | Strong conclusion or claim | Use one short message                                      |

## Built-in themes

| Theme          | Character                          | Layouts                                                             |
| -------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `default`      | Neutral general-purpose styling    | cover, default, section, page, two-column, number, quote, statement |
| `minimal`      | Monochrome, document-like styling  | cover, default, section, page, two-column, number, quote, statement |
| `bold`         | Warm colors and forceful headings  | cover, default                                                      |
| `google-basic` | Blue, clear structural hierarchy   | cover, section, page, two-column, number, quote, statement          |
| `apple-basic`  | High contrast and large typography | cover, section, page, two-column, number, quote, statement          |

Deck-level theme metadata takes precedence over `deckup.config.*`, which takes precedence over `default`. Never select a layout the active theme does not provide.

## Two-column named slots

Use `left` and `right` with supporting themes, including `google-basic` and `apple-basic`.

```mdx
<layout id="two-column" />

# Build or buy?

<div slot="left">

## Build

- Full control
- Higher maintenance

</div>

<div slot="right">

## Buy

- Faster start
- Vendor dependency

</div>
```

## Configuration

Keep exactly one `deckup.config.*` file at the project root. Use this TypeScript baseline:

```ts
import { defineConfig } from "deckup";

export default defineConfig({
  port: 4321,
  theme: "google-basic",
});
```

The public fields are `port`, `theme`, and the `astro` subset supported by Deckup. Do not set Deckup-owned fields: `root`, `srcDir`, `configFile`, `output`, `server`, `outDir`, `logLevel`, or `devToolbar`.

## Content and design

- Edit content to fit within a fixed 16:9 slide.
- Keep cover, section, and statement slides brief.
- Use parallel grammar in lists and avoid deep nesting.
- Show only essential code and limit both line count and line length.
- Preserve paragraph order in number and quote layouts because order affects styling.
- Start with the theme's spacing and typography. Do not override the entire theme with custom CSS.
- Keep images within the available area and provide meaningful `alt` text.
