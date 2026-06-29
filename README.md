# Slida

Astro-native slide deck tooling for authoring `.astro` and `.mdx` slides.

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
