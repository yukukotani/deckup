# Deckup

Astro-native slide deck tooling for authoring `.astro` and `.mdx` slides.

## Tailwind CSS

The Deckup CLI enables Tailwind CSS v4 for `.astro` and `.mdx` decks by default.
Deck authors do not need to install Tailwind packages, register a Vite plugin, or import a Tailwind stylesheet.
Use utility classes directly in a deck:

```astro
---
import Page from "@deckup/astro/page";
---

<Page title="Tailwind">
  <h1 class="text-5xl font-bold text-blue-600">Built in</h1>
</Page>
```

Configure the built-in through the known `integrations.tailwind` key.
The options are passed directly to `@tailwindcss/vite` without Deckup-specific defaults:

```ts
import { defineConfig, type DeckupTailwindOptions } from "deckup";

const tailwind: DeckupTailwindOptions = {
  optimize: { minify: false },
};

export default defineConfig({
  integrations: { tailwind },
});
```

Set the key to `false` to disable the built-in plugin and stylesheet for one deck:

```ts
export default defineConfig({
  integrations: { tailwind: false },
});
```

Built-in Tailwind plugins run before plugins from `astro.vite.plugins`.
Deckup preserves manually configured Tailwind plugins instead of detecting or de-duplicating them.
This built-in belongs to the Deckup CLI and `deckup.config.*` path; Astro hosts using `@deckup/astro` continue to own their host styling configuration.

## Themes

Select a theme in `deckup.config.ts` with the top-level `theme` option:

```ts
import { defineConfig } from "deckup";

export default defineConfig({
  theme: "google-basic",
});
```

Deckup ships four first-party themes: `default`, `minimal`, `google-basic`, and `apple-basic`.
Omitting `theme` uses `default`.
First-party themes are regular npm packages in this workspace (`@deckup/theme-default`, `@deckup/theme-minimal`, `@deckup/theme-google-basic`, and `@deckup/theme-apple-basic`), while slide authors use the short names above.

Themes provide Astro layout components instead of a package-root CSS file.
A slide selects a layout with the import-free `<PageMeta layout="..." />` marker, and Deckup injects the slide body into the selected layout's slots. Place the marker before page content; Deckup consumes it during compilation and never renders it.
Single-region layouts use the default slot, so authors can write normal content without a `slot` attribute.
Multi-region layouts use Astro's standard named slot syntax:

```astro
<Page title="Two-column page title">
  <PageMeta layout="two-column" />
  <h1>This is page title</h1>
  <p slot="left">Left column content</p>
  <p slot="right">Right column content</p>
</Page>
```

In the built-in `google-basic` and `apple-basic` themes, the `two-column` layout exposes the `left` and `right` named slots shown above.

The same `slot="left"` / `slot="right"` attributes work in MDX when using JSX elements:

```mdx
<PageMeta layout="two-column" />

# This is page title

<p slot="left">Left column content</p>
<p slot="right">Right column content</p>
```

### npm theme packages

For a third-party theme, install the package in your deck project and use the package specifier exactly:

```ts
export default defineConfig({
  theme: "@acme/deckup-theme",
});
```

A theme package must expose its package metadata and convention-based Astro layout files from `layouts/*.astro`:

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

Each layout id comes from its filename.
For example, `layouts/default.astro` provides the `default` layout and `layouts/two-column.astro` provides the `two-column` layout:

```astro
---
import "./styles.css";
---

<article class="theme-two-column">
  <header><slot /></header>
  <section><slot name="left" /></section>
  <section><slot name="right" /></section>
</article>
```

CSS-only theme packages that export `style.css` from `.` are no longer supported.
Move shared styling into files imported by the layout components, such as `layouts/styles.css`.
Programmatic integrations should use `resolveDeckupThemeLayouts()` for resolved theme metadata.
The previous `resolveDeckupTheme` named export was intentionally removed with the CSS-only resolver; it no longer exists as a package-root CSS resolver.
During development, Deckup watches the selected theme's layout files and `layouts/` directory, re-discovers layout membership, and refreshes generated Page slot forwarding when layout slot declarations change.

## Development

- Install workspace dependencies:

```bash
vp install
```

- Start the Deckup preview server:

```bash
vp run dev
# or run the example package directly:
vp run example#dev
```

- Build the static Web deck:

```bash
vp run example#build
```

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

## Browser verification

Use the sample package in `example/` to verify that development and static output have the same visible deck behavior.

1. Start the preview server with `vp run dev` or `vp run example#dev`.
2. Open the printed local URL in a browser and confirm the first slide shows `This is presentation title`.
3. Press <kbd>→</kbd> or <kbd>PageDown</kbd> and confirm the second slide shows `This is section title` and the URL hash changes to `#2`.
4. Press <kbd>←</kbd> or <kbd>PageUp</kbd> and confirm the first slide is visible again and the URL hash changes to `#1`.
5. Run `vp run example#build`, serve the generated `example/dist/` directory, and repeat the same first-slide and navigation checks against the static output.
6. Confirm the example config uses `theme: "default"` and that the two-column slide routes the `slot="left"` and `slot="right"` content into the corresponding regions.
