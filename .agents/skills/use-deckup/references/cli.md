# Deckup CLI reference

Run commands from the deck project root through `npx deckup` unless the project defines an equivalent local script. Pass the target deck's actual path inside the project; Deckup decks do not need to live under `slides/`.

## Discover commands

```bash
npx deckup --help
npx deckup --version
npx deckup open --help
npx deckup build --help
npx deckup inspect --help
npx deckup inspect theme --help
```

Use these public commands:

| Command                      | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `open <deck-file>`           | Start an interactive Astro preview server   |
| `build <deck-file>`          | Build PDF, static HTML, or PNG images       |
| `inspect theme <theme-name>` | Describe a theme's public layouts and slots |

## Preview interactively

Use `open` for an interactive preview or when a browser-based development loop is requested. Treat it as a long-running process.

```bash
npx deckup open presentation.mdx
npx deckup open content/presentation.astro --host 0.0.0.0 --port 4321 --open
```

| Option                       | Default                    | Meaning                 |
| ---------------------------- | -------------------------- | ----------------------- |
| `--host <host>`              | `127.0.0.1`                | Development server host |
| `--port <port>`, `-p <port>` | Config `port`, then `4321` | Development server port |
| `--open`                     | Off                        | Open the browser        |
| `--logLevel <level>`         | `info`                     | Astro log level         |

Use `debug`, `info`, `warn`, `error`, or `silent` as log levels.

## Build static HTML

```bash
npx deckup build presentation.mdx --format html
npx deckup build presentation.mdx --format html --out public-deck
```

Treat `--out` as a directory. When omitted, build `presentation.mdx` to `presentation/` under the project root.

## Build PDF

```bash
npx deckup build presentation.mdx
npx deckup build presentation.mdx --format pdf --out presentation.pdf --force
```

Treat PDF as the default `build` format and `--out` as a PDF file. When omitted, write `<deck-basename>.pdf` under the project root. Use `--force` or `-f` only to overwrite an existing PDF non-interactively.

## Build PNG previews

```bash
# All slides
npx deckup build presentation.mdx --format png --out /tmp/deckup-preview

# Selected slides; numbers are one-based and ranges are inclusive
npx deckup build presentation.mdx --format png --slides 1,3-5 --out /tmp/deckup-preview
```

- Expect 1600×900 images named like `slide-001.png`.
- Read stdout as absolute PNG paths, one per line in deck order.
- Use `--slides` only with `--format png`.
- Expect Deckup to de-duplicate selections and render them in deck order.
- Omit `--force`; it has no effect for PNG.
- Use only a dedicated disposable output directory. Deckup recursively removes and replaces an accepted PNG output directory.
- Never select a filesystem root, the project root, a directory containing the source deck, or a path overlapping Deckup's internal `dist` staging directory.
- Expect a selected-slide build to leave only the PNGs selected in that invocation.
- When `--out` is omitted, expect a directory named after the deck basename under the project root. Prefer an explicit disposable directory for review work.

## Inspect a theme

Inspect theme and layout descriptions together with slots before selecting them:

```bash
npx deckup inspect theme default
npx deckup inspect theme google-basic --json
npx deckup inspect theme @acme/deckup-theme --json
```

- Resolve the active theme from the target deck's metadata first, then the top-level `theme` in `deckup.config.*`, then `default`.
- Always pass that resolved theme name. The current CLI requires `<theme-name>` and does not infer a theme when it is omitted.
- Use a built-in theme name or the exact name of a package already installed in the deck project.
- Use `--json` for machine-readable theme descriptions, layouts, layout descriptions, and slots.
- Use authored descriptions as selection guidance instead of relying only on layout IDs.
- Do not pass npm aliases or download specifiers such as `npm:@acme/deckup-theme`; install the package first.

## Troubleshoot common failures

- Use an existing `.mdx` or `.astro` deck inside the project root.
- Set `--format` to `html`, `pdf`, or `png`.
- Fix zero, negative, reversed, out-of-range, or empty PNG selections.
- Consolidate multiple `deckup.config.*` files into one.
- Default-export a plain object or `defineConfig({...})` from the configuration file.
- Run `npx deckup inspect theme <theme-name>` when a layout or slot is rejected.
- If Chromium download or launch fails, inspect the environment. Set `DECKUP_CHROMIUM_EXECUTABLE_PATH` or `DECKUP_BROWSER_CACHE_DIR` when required.
- If an uncached npm theme requires interactive confirmation, install the theme or prepare its cache before running non-interactively.
