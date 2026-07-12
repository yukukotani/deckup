# Deckup theme authoring reference

## Package contract

A Deckup theme is an npm package whose public layouts are direct `layouts/*.astro` files. Deckup has no `Theme` object or `defineTheme()` API.

Use this minimum manifest:

```json
{
  "name": "@acme/deckup-theme",
  "version": "0.1.0",
  "type": "module",
  "files": ["layouts"],
  "exports": {
    "./layouts/*.astro": "./layouts/*.astro",
    "./package.json": "./package.json"
  }
}
```

Deckup resolves package metadata, then reads the package's `layouts/` directory. A CSS-only package-root theme is not supported.

Package rules:

- Include at least one readable, direct `layouts/*.astro` file.
- Derive the layout ID from the filename without `.astro`.
- Match layout IDs against `^[a-z][a-z0-9-]*$`.
- Ignore files beginning with `_`; use them for private helpers when useful.
- Do not expect nested layout directories to be discovered.
- Export `./package.json` and `./layouts/*.astro`.
- Add font, image, or other asset directories to `files`; export them too when package resolution requires it.

## Single-region layout

Import shared styling and render the default slot:

```astro
---
import "./styles.css";
---

<slot />
```

Deckup renders the layout inside this runtime structure:

```html
<div class="deckup-shell">
  <section
    class="deckup-slide"
    data-deckup-slide
    data-deckup-theme="@acme/deckup-theme"
    data-deckup-layout="page"
  >
    <!-- The selected Astro layout renders here. -->
  </section>
</div>
```

The shell is a 16:9 size container. The slide fills it and clips overflow.

## Named-slot layout

Declare named slots with static string literals in the public layout source:

```astro
---
import "./styles.css";
---

<slot />
<section class="theme-column theme-column--left">
  <slot name="left" />
</section>
<section class="theme-column theme-column--right">
  <slot name="right" />
</section>
```

Deckup parses each public layout file and forwards the union of discovered names. Therefore:

- Use literal names such as `<slot name="left" />`.
- Do not use expressions or dynamic names.
- Do not hide named slot declarations only inside an imported child component; Deckup does not follow component imports while discovering slot names.
- Treat slot names as public API.

Slide authors consume a named-slot layout with the import-free marker:

```mdx
<PageMeta layout="two-column" />

# Compare

<div slot="left">Left content</div>
<div slot="right">Right content</div>
```

The same `slot` attributes work in Astro decks.

## Defaults and recommended layouts

When a slide omits `<PageMeta>`:

- slide 1 uses `cover`;
- slides 2 and later use `default`.

Include both files for a broadly usable theme. Common conventional layouts are:

| ID           | Purpose            | Typical content contract                      |
| ------------ | ------------------ | --------------------------------------------- |
| `cover`      | Opening            | Title and short subtitle                      |
| `default`    | General fallback   | Heading, prose, lists, or code                |
| `page`       | Structured content | Heading followed by body                      |
| `section`    | Section divider    | One short heading                             |
| `statement`  | Main claim         | One short statement                           |
| `number`     | Metric             | Number first, explanation second              |
| `quote`      | Quotation          | Quote first, attribution second               |
| `two-column` | Comparison         | Default heading plus `left` and `right` slots |

Only the filename and slots are enforced. The semantic content contracts above are conventions encoded by theme CSS selectors.

## CSS integration

Put shared CSS beside the layouts and import it from each public layout that uses it.

Useful selectors:

```css
:root {
  --deckup-bg: #ffffff;
  --deckup-text: #475569;
  --deckup-text-strong: #0f172a;
  --deckup-border: #cbd5e1;
  --deckup-shadow: 0 12px 30px rgb(15 23 42 / 0.12);
}

.deckup-shell {
  background: var(--deckup-bg);
}

.deckup-slide {
  --theme-cqw: 1cqw;
  display: grid;
  padding: clamp(2.5rem, calc(7 * var(--theme-cqw)), 7rem);
  color: var(--deckup-text);
  background: var(--deckup-bg);
}

[data-deckup-layout="cover"] {
  place-content: center;
  text-align: center;
}
```

Deckup's runtime consumes `--deckup-bg`, `--deckup-text-strong`, `--deckup-border`, `--deckup-shadow`, and `--deckup-mono` for shell and navigation styling. Defining them keeps runtime chrome coherent with the theme.

Prefer container-query units because the slide scales inside a 16:9 shell. Bound extremes with `clamp()`. Keep `box-sizing`, grid tracks, long code, images, and slot wrappers from overflowing the fixed frame.

Use `[data-deckup-layout="..."]` for layout-specific differences. Namespace custom classes to avoid collisions with slide content.

## Fonts and assets

Reference packaged assets relative to the importing stylesheet or component:

```css
@font-face {
  font-family: "Acme Sans";
  src: url("../fonts/acme-sans.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
```

Then include and, when necessary, export the directory:

```json
{
  "files": ["fonts", "layouts"],
  "exports": {
    "./layouts/*.astro": "./layouts/*.astro",
    "./fonts/*": "./fonts/*",
    "./package.json": "./package.json"
  }
}
```

Verify the packed tarball rather than relying on files present only in the source checkout.

## Selecting a theme

For an installed theme package, use its exact package specifier:

```ts
import { defineConfig } from "deckup";

export default defineConfig({
  theme: "@acme/deckup-theme",
});
```

Deck metadata overrides project configuration:

```mdx
---
title: Theme preview
theme: "@acme/deckup-theme"
---
```

```astro
---
import Page from "@deckup/astro/page";
const theme = "@acme/deckup-theme";
---
```

Theme values must be non-empty static strings. `npm:package` and exact `npm:package@version` forms can use Deckup's managed cache, but an uncached download requires interactive approval and fails closed in non-interactive environments.

## Compatibility rules

- Keep existing layout IDs and slot names unless intentionally publishing a breaking change.
- Adding a layout is normally additive; removing or renaming one breaks decks that select it.
- Changing content-order selectors, such as `p:first-of-type`, can silently alter existing slides.
- Keep shared CSS compatible with all layouts that import it.
- Test both implicit `cover` and `default` selection and explicit layout selection.
- Test MDX slot content containing headings, paragraphs, lists, code, and images—not only plain text.
