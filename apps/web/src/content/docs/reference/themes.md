---
title: Theme reference
description: Built-in theme names, npm theme package requirements, layout IDs, and named slots.
---

# Theme reference

Themes provide Astro layout components for Slida pages.
A deck selects a theme with the top-level `theme` field in `slida.config.*`.

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

## Npm theme packages

For a third-party theme, install the package in your deck project and use the package specifier exactly:

```ts
export default defineConfig({
  theme: "@acme/slida-theme",
});
```

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

Slida resolves `${packageName}/package.json` first, then reads layout components from the package's `layouts/` directory.
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
