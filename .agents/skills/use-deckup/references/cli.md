# Deckup CLI reference

Run all commands through `npx deckup`. The public commands are `open` and `build`.

## Preview

Use the interactive development preview only when the user explicitly requests it.

```bash
npx deckup open slides/deck.mdx
npx deckup open slides/deck.astro --host 0.0.0.0 --port 4321 --open
```

| Option                       | Default                    | Meaning                 |
| ---------------------------- | -------------------------- | ----------------------- |
| `--host <host>`              | `127.0.0.1`                | Development server host |
| `--port <port>`, `-p <port>` | Config `port`, then `4321` | Development server port |
| `--open`                     | Off                        | Open the browser        |
| `--logLevel <level>`         | `info`                     | Astro log level         |

## Build HTML

```bash
npx deckup build slides/deck.mdx --format html
npx deckup build slides/deck.mdx --format html --out public-deck
```

`--out` is a directory. When omitted, `slides/deck.mdx` builds to `deck/` under the project root.

## Build PDF

```bash
npx deckup build slides/deck.mdx
npx deckup build slides/deck.mdx --format pdf --out deck.pdf --force
```

PDF is the default `build` format. `--out` is a PDF file. When omitted, the output is `deck.pdf` under the project root. Use `--force` or `-f` to overwrite an existing PDF non-interactively.

## Build PNG previews

```bash
# All slides
npx deckup build slides/deck.mdx --format png --out /tmp/deckup-preview

# Selected slides; numbers are one-based and ranges are inclusive
npx deckup build slides/deck.mdx --format png --slides 1,3-5 --out /tmp/deckup-preview
```

- Images are 1600×900 and named like `slide-001.png`.
- On success, stdout contains each generated image's absolute path, one per line in deck order.
- `--slides` is PNG-only. Do not combine it with HTML or PDF output.
- Deckup de-duplicates selections and renders them in deck order.
- `--force` is unnecessary for PNG and has no effect.
- A PNG build recursively removes and replaces an accepted `--out` directory. Use only a dedicated disposable directory.
- Do not select a filesystem root, the project root, a directory containing the source deck, or a path overlapping Deckup's internal build directory.
- When rendering only selected slides, the output directory retains only the PNGs selected in that invocation.

## Common failures

- Use an existing `.mdx` or `.astro` deck inside the project root.
- Set `--format` to `html`, `pdf`, or `png`.
- Fix zero, negative, reversed, out-of-range, or empty PNG selections.
- Consolidate multiple `deckup.config.*` files into one.
- Default-export a plain object or `defineConfig({...})` from the configuration file.
- If Chromium download or launch fails, inspect the environment. Set `DECKUP_CHROMIUM_EXECUTABLE_PATH` or `DECKUP_BROWSER_CACHE_DIR` when required.
- An uncached npm theme may require interactive download confirmation. Install the theme or prepare its cache before running non-interactively.
