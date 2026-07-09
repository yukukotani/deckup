---
title: Theme reference
description: Built-in theme names, npm theme package requirements, layout IDs, and named slots.
---

# Theme reference

Themes provide Astro layout components for Slida pages.
The top-level `theme` field in `slida.config.*` sets the fallback theme for decks that do not declare their own theme.

```ts
import { defineConfig } from "@slida/cli";

export default defineConfig({
  theme: "google-basic",
});
```

## Built-in themes

Slida includes these built-in theme names:

- `default`
- `minimal`
- `bold`
- `google-basic`
- `apple-basic`

If you omit `theme`, Slida uses `default`.
Built-in names resolve to first-party packages such as `@slida/theme-default` and `@slida/theme-google-basic`.

## Deck-level theme overrides

A deck can override the configured fallback theme with static top-level metadata.
Slida resolves theme precedence as:

1. Deck metadata theme.
2. `slida.config.*` theme.
3. `default`.

In MDX decks, add YAML frontmatter:

```mdx
---
title: Product update
theme: minimal
---

# Product update
```

In Astro decks, declare a static top-level constant in the frontmatter script:

```astro
---
import Page from "@slida/astro/page";
const theme = "bold";
---

<Page title="Launch">
  <h1>Launch</h1>
</Page>
```

The deck-level theme must be a static string.
Dynamic expressions and non-string values are not supported.
If a deck selects an invalid theme, Slida reports the error with the deck path that declared it.

## Npm theme packages

For a third-party theme, you can either install the package in your deck project or let Slida download an npm package into a Slida-managed cache.
Both modes use the same package contract: Slida reads package metadata first, then reads Astro layout components from the package's `layouts/` directory.

### Installed package themes

Install the package in your deck project and use the package specifier exactly:

```ts
export default defineConfig({
  theme: "@acme/slida-theme",
});
```

### Auto-downloaded npm themes

Use the `npm:` prefix to let Slida resolve the theme from the npm registry before Astro starts:

```ts
export default defineConfig({
  theme: "npm:@acme/slida-theme@1.2.3",
});
```

`npm:package` and exact `npm:package@version` specs are supported.
Slida stores downloaded packages in its user cache and reuses the cache for the same spec.
Set `SLIDA_THEME_CACHE_DIR` to use a different cache directory.

When an uncached `npm:` theme needs a download, Slida asks for confirmation before contacting the npm registry.
In non-interactive environments, Slida stops with guidance instead of downloading automatically.

A theme package must expose package metadata and Astro layout files:

```json
{
  "name": "@acme/slida-theme",
  "type": "module",
  "exports": {
    "./layouts/*.astro": "./layouts/*.astro",
    "./package.json": "./package.json"
  },
  "files": ["layouts"]
}
```

CSS-only package-root themes are not supported.
Put shared styling in files imported by layout components instead.

## Layout IDs

A theme must include at least one readable `layouts/*.astro` file.
Files whose names start with `_` are ignored.
Each layout ID comes from the file name without the `.astro` extension.
For example:

- `layouts/default.astro` provides the `default` layout.
- `layouts/cover.astro` provides the `cover` layout.
- `layouts/two-column.astro` provides the `two-column` layout.

Layout IDs must start with a lowercase letter and may contain lowercase letters, numbers, and hyphens.

## Named slots

Slida detects named slots from `<slot name="..." />` elements in layout components.
Slide authors target those slots with Astro's standard `slot` attribute:

```astro
<Page title="Two-column slide">
  <layout id="two-column" />
  <h1>Two columns</h1>
  <p slot="left">Left side</p>
  <p slot="right">Right side</p>
</Page>
```

The built-in `google-basic` and `apple-basic` themes include a `two-column` layout with `left` and `right` slots.
Available layout IDs and slots depend on the selected theme.
