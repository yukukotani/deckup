---
name: create-deckup-theme
description: Create, edit, package, and visually verify Deckup themes implemented as npm packages of Astro layout components. Use when creating or changing a Deckup theme package, files under its layouts directory, layout slots, theme CSS, fonts or assets, package exports, or a consumer deck's theme preview fixtures. Do not use for ordinary slide authoring unless the theme package itself must change.
---

# Create Deckup Theme

Build Deckup layout-component themes and verify them against a representative consumer deck.

## Read the relevant references

- Read [references/theme-authoring.md](references/theme-authoring.md) before creating or changing package metadata, layouts, slots, CSS, fonts, or assets.
- Read [references/visual-review.md](references/visual-review.md) before rendering and evaluating a theme.
- Use [scripts/init_theme.py](scripts/init_theme.py) to scaffold a new theme package when no repository-specific generator or established package skeleton exists.
- Copy [assets/theme-preview.mdx](assets/theme-preview.mdx) into a disposable deck project's `slides/` directory when a representative preview deck is needed. Replace `THEME_PACKAGE_NAME`, remove slides for unsupported layouts, and add any audience-specific stress cases listed in the visual review reference.

## Workflow

### 1. Inspect the context

1. Read repository instructions and inspect the package manager, workspace layout, nearby theme packages, consumer deck, and test commands.
2. Classify the task as creating a new npm theme or editing an existing theme's package metadata, layouts, slots, CSS, fonts, or assets.
3. Inspect every existing `layouts/*.astro`, shared stylesheet, exported asset directory, package manifest, preview deck, and theme-specific test before editing.
4. Establish the intended audience, visual character, brand constraints, required layouts, light/dark behavior, and publication target. Ask only when a missing decision would materially change the design.

### 2. Establish the theme contract

1. Treat a theme as an npm package containing convention-based Astro components under `layouts/`. Do not invent a `defineTheme()` call or a JavaScript theme object.
2. Include `cover.astro` and `default.astro` unless the theme intentionally requires every slide to select a layout. Deckup defaults the first slide to `cover` and later slides to `default`.
3. Select only layouts the content model needs. A practical complete set is `cover`, `default`, `page`, `section`, `statement`, `number`, `quote`, and `two-column`.
4. Define each multi-region layout's named slots as literal `<slot name="..." />` elements in that layout file. Keep names stable because they are public authoring API.

For a new package, scaffold first:

```bash
python3 <skill-directory>/scripts/init_theme.py path/to/theme \
  --package-name @acme/deckup-theme
```

Then adapt the generated layouts and CSS rather than preserving placeholder aesthetics.

### 3. Implement or edit the theme

1. Import shared CSS from every public layout component that relies on it.
2. Render ordinary slide content with `<slot />`. Wrap named slots only when the layout needs dedicated grid or flex regions.
3. Scope layout differences with `[data-deckup-layout="..."]`; use `.deckup-slide` for shared slide styling and `.deckup-shell` only for the outer frame.
4. Design for Deckup's fixed 16:9 container. Prefer container-relative units such as `cqw`, bounded by `clamp()`, over viewport assumptions.
5. Keep text contrast, hierarchy, line length, focus visibility, overflow behavior, and print output usable. Do not solve overflow by shrinking all typography.
6. Include fonts and other assets in package `files`; reference them with package-relative URLs and export their directories when required by package resolution.
7. Preserve existing layout IDs, slot names, selectors, and visual behavior unless the requested change deliberately breaks that API.

### 4. Integrate with a consumer deck

1. Install the theme in a separate consumer deck project and select its exact package name in `deckup.config.*`.
2. Use a static deck-level theme override only when the preview must override project configuration:
   - MDX: `theme: "@acme/deckup-theme"` in YAML frontmatter.
   - Astro: `const theme = "@acme/deckup-theme"` in frontmatter.
3. Exercise every layout and every named slot. Do not infer correctness from one cover slide.
4. Never edit generated `.deckup/`, `.astro/`, `dist/`, or rendered output as the source of a fix.

### 5. Render and visually review

Build all preview slides into a disposable directory:

```bash
PREVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deckup-theme-preview.XXXXXX")"
npx deckup build slides/theme-preview.mdx --format png --out "$PREVIEW_DIR"
```

1. Open every generated PNG with an image viewer; in pi, use `view_image`.
2. Apply [references/visual-review.md](references/visual-review.md).
3. Fix source layouts or CSS, rerender affected slides with `--slides`, and reopen them.
4. Repeat until no significant clipping, overlap, hierarchy, contrast, consistency, or slot-routing issue remains.

Never claim visual verification without opening the rendered images. State the limitation when image viewing is unavailable.

### 6. Verify packaging and behavior

Run the theme repository's focused checks first, then its handoff check when practical. Verify at minimum:

```bash
npm pack --dry-run
HTML_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deckup-theme-html.XXXXXX")"
npx deckup build slides/theme-preview.mdx --format html --out "$HTML_DIR"
```

Confirm that:

- the tarball includes all public layouts and referenced assets;
- the consuming deck resolves the package and every selected layout;
- named-slot content appears in the intended region;
- PNG and HTML builds succeed;
- development refreshes after changing CSS, a layout, or its literal slot declarations.

### 7. Report completion

- List changed package, layout, preview, and asset paths.
- List commands run and their results.
- Name the preview slides opened and summarize visual fixes.
- Disclose unsupported layouts, unverified formats, publication work, or remaining compatibility risks.
