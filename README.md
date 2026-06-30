# Slida

Astro-native slide deck tooling for authoring `.astro` and `.mdx` slides.

## Themes

Select a theme in `slida.config.ts` with the top-level `theme` option:

```ts
import { defineConfig } from "@slida/cli";

export default defineConfig({
  theme: "minimal",
});
```

Slida ships three first-party themes: `default`, `minimal`, and `bold`.
Omitting `theme` uses `default`.
First-party themes are regular npm packages in this workspace (`@slida/theme-default`, `@slida/theme-minimal`, and `@slida/theme-bold`), while slide authors use the short names above.

Theme CSS is loaded after Slida's base runtime CSS and before deck-authored CSS.
You can still import deck-specific CSS from your `.astro` or `.mdx` deck; those imports remain later in the cascade and can override theme tokens.

### npm theme packages

For a third-party theme, install the package in your deck project and use the package specifier exactly:

```ts
export default defineConfig({
  theme: "@acme/slida-theme",
});
```

A theme package must export CSS from its package root:

```json
{
  "name": "@acme/slida-theme",
  "type": "module",
  "exports": {
    ".": "./style.css"
  },
  "files": ["style.css"]
}
```

```css
:root {
  --slida-bg: #0f172a;
  --slida-text: #cbd5e1;
  --slida-text-strong: #f8fafc;
  --slida-accent: #38bdf8;
}
```

Theme packages are CSS-only in this first version.
Astro component/layout distribution is reserved for a later extension point.

## Development

- Install workspace dependencies:

```bash
vp install
```

- Start the Slida preview server:

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
2. Open the printed local URL in a browser and confirm the first slide shows `Astro-native slides`.
3. Press <kbd>→</kbd> or <kbd>PageDown</kbd> and confirm the second slide shows `MDX works too` and the URL hash changes to `#2`.
4. Press <kbd>←</kbd> or <kbd>PageUp</kbd> and confirm the first slide is visible again and the URL hash changes to `#1`.
5. Run `vp run example#build`, serve the generated `example/dist/` directory, and repeat the same first-slide and navigation checks against the static output.
6. Confirm the example config uses `theme: "minimal"` and that deck-authored Tailwind styles still override theme tokens where the slides define their own utility classes.
