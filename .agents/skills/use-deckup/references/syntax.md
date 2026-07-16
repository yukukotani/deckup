# Deckup syntax reference

Use one `.mdx` or `.astro` source file per deck. Preserve an existing deck's format unless a deliberate migration is required.

## Choose a source format

- Use `.mdx` for Markdown-led decks, fast authoring, and standard layout composition.
- Use `.astro` for Astro components, precise markup, framework components, and complex named-slot content.

## Author MDX decks

Declare deck metadata in YAML frontmatter and separate slides with `---`.

```mdx
---
title: Product update
theme: google-basic
---

# Product update

What changed and why it matters

---

<PageMeta layout="page" />

# Three outcomes

- Faster onboarding
- Fewer support requests
- Clearer ownership
```

Apply these rules:

- Do not create empty slides with adjacent separators or a trailing separator.
- Omit `<PageMeta>` to use `cover` on slide one and `default` on later slides. Omit it on later slides only when the active theme exposes `default`; otherwise select an available content layout such as `page` explicitly.
- Place at most one import-free `<PageMeta layout="..." />` as the first meaningful item on a slide.
- Use exactly one static, non-empty `layout` string attribute. Keep the marker self-closing and childless.
- Do not use expressions, spreads, unknown attributes, paired tags, or a user-defined `PageMeta` component.
- Use MDX imports and JSX or HTML when needed. Assign named slots with static `slot` attributes.

## Author Astro decks

Default-import `Page` from `@deckup/astro/page`, declare an optional static theme, and place only `<Page>` components at the top level.

```astro
---
import Page from "@deckup/astro/page";
const theme = "google-basic";
---

<Page title="Product update" layout="cover">
  <h1>Product update</h1>
  <p>What changed and why it matters</p>
</Page>

<Page title="Two priorities" layout="two-column">
  <h1>Two priorities</h1>
  <section slot="left">
    <h2>Now</h2>
    <p>Remove the largest blocker.</p>
  </section>
  <section slot="right">
    <h2>Next</h2>
    <p>Scale the proven path.</p>
  </section>
</Page>
```

Apply these rules:

- Include at least one `<Page>` and give every page a concise `title` for its accessible slide name.
- Use a static, non-empty `layout` string when selecting a layout. Omit it to use `cover` on page one and `default` later. Omit it on later pages only when the active theme exposes `default`; otherwise select an available content layout explicitly.
- Put prop spreads before an explicit `layout` prop so a spread cannot overwrite it.
- Declare `const theme = "..."` as a static string in frontmatter when selecting a deck-level theme.
- Use `<PageMeta layout="..." />` only when maintaining an existing Astro deck that already follows that equivalent form. Do not combine `layout` and `PageMeta` on the same page.

## Use layouts and slots

Resolve the active theme before assuming layout support:

1. Use the target deck's theme metadata when present: MDX YAML `theme` or a static Astro `const theme = "..."`.
2. Otherwise use the top-level `theme` from `deckup.config.*` when present.
3. Otherwise use `default`.

Inspect the active theme. Omit the name to use project config and then `default`; pass the exact name when deck metadata overrides project config:

```bash
npx deckup inspect theme --json
npx deckup inspect theme google-basic
npx deckup inspect theme google-basic --json
```

The inspect command does not accept a deck-file argument, so it cannot discover theme metadata from a target deck. Explicit theme names take priority and bypass config loading.

- Start layout IDs with a lowercase letter and use only lowercase letters, numbers, and hyphens.
- Use the default slot for ordinary content.
- Use only named slots reported by theme inspection. For example, a `two-column` layout commonly exposes `left` and `right`.

```mdx
<PageMeta layout="two-column" />

# Build or buy?

<section slot="left">

## Build

- Full control
- Higher maintenance

</section>

<section slot="right">

## Buy

- Faster start
- Vendor dependency

</section>
```

Use common layout semantics when the theme provides them:

| Layout             | Use                        | Content guidance                                              |
| ------------------ | -------------------------- | ------------------------------------------------------------- |
| `cover`            | Opening                    | Keep the title and subtitle brief                             |
| `section`          | Section divider            | Make one short heading the focal point                        |
| `default` / `page` | General content            | Combine a heading with concise prose, lists, figures, or code |
| `two-column`       | Comparison or parallelism  | Balance density across the reported named slots               |
| `number`           | KPI or metric              | Put the number first and its context second                   |
| `quote`            | Quotation                  | Put the quote first and attribution second                    |
| `statement`        | Strong claim or conclusion | Use one short message                                         |

Deckup includes `default`, `minimal`, `google-basic`, and `apple-basic`. Treat `npx deckup inspect theme` as authoritative because themes can expose different layouts and slots.

## Configure Deckup

Keep at most one `deckup.config.*` file at the project root.

```ts
import { defineConfig } from "deckup";

export default defineConfig({
  port: 4321,
  theme: "google-basic",
  integrations: {
    tailwind: {},
  },
  astro: {},
});
```

- Use only `port`, `theme`, `integrations`, and the supported `astro` subset.
- Do not set Deckup-owned Astro fields: `root`, `srcDir`, `configFile`, `output`, `server`, `outDir`, `logLevel`, or `devToolbar`.
- Let deck-level theme metadata override `deckup.config.*`; let configuration override the `default` fallback.
- Install a third-party theme and use its exact package specifier, such as `@acme/deckup-theme`.
- Use Tailwind CSS v4 utility classes directly; Deckup enables Tailwind by default. Set `integrations.tailwind` to options or `false` to configure or disable it.

## Fit content to slides

- Keep one primary message per fixed 16:9 slide.
- Make the argument understandable from slide titles alone.
- Keep cover, section, number, quote, and statement slides especially brief.
- Use parallel list grammar, avoid deep nesting, and limit code line count and width.
- Preserve content order when a layout styles the first and second blocks differently.
- Keep images within the frame, preserve aspect ratio, provide meaningful `alt` text, and maintain sufficient contrast.
- Prefer theme spacing and typography over broad custom CSS overrides.
