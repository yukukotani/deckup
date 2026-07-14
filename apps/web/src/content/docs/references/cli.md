---
title: CLI
description: Command syntax, output formats, and options for Deckup.
---

The `deckup` command accepts `.astro` and `.mdx` deck files.
Running it without a subcommand prints a reminder to use `deckup open` or `deckup build`.

## `deckup open`

Preview a deck with Astro's development server:

```bash
deckup open slides/deck.mdx
```

| Option                       | Default                    | Description                     |
| ---------------------------- | -------------------------- | ------------------------------- |
| `--host <host>`              | `127.0.0.1`                | Development server host.        |
| `--port <port>`, `-p <port>` | Config `port`, then `4321` | Development server port.        |
| `--open`                     | `false`                    | Open the browser after startup. |
| `--logLevel <level>`         | `info`                     | Astro log level.                |

## `deckup build`

Build a deck. PDF is the default format:

```bash
deckup build slides/deck.mdx
deckup build slides/deck.mdx --format html --out public-deck
deckup build slides/deck.mdx --format png --slides 1,3-5 --out rendered-slides
```

| Option                      | Default          | Description                                              |
| --------------------------- | ---------------- | -------------------------------------------------------- |
| `--format <html\|pdf\|png>` | `pdf`            | Output static HTML/assets, a PDF, or PNG images.         |
| `--out <path>`              | Format-dependent | PDF file or HTML/PNG directory.                          |
| `--slides <selection>`      | All slides       | PNG-only one-based numbers, lists, and inclusive ranges. |
| `--force`, `-f`             | `false`          | Overwrite an existing PDF without prompting.             |
| `--logLevel <level>`        | `info`           | Astro log level; PNG output always uses `silent`.        |

### PNG behavior

PNG selections are validated completely, de-duplicated, and rendered in deck order.
Images are named `slide-NNN.png`, use one-based numbering, and contain only the 1600×900 slide body.
On success, stdout contains one absolute image path per line.

PNG output replaces the selected directory in full.
Deckup rejects filesystem roots, the project root, directories containing the source deck, and paths that overlap its internal static build directory.

## Configuration

Set project defaults and extend Astro through `deckup.config.*`.
See the [Config reference](/references/config/) for supported filenames, fields, and Deckup-owned Astro options.

## Recovering a corrupt Chromium cache

PNG and PDF export download a cached Chromium build.
If that cache becomes corrupt, stop any running Deckup process, then remove only the configured Deckup browser cache directory (the path from `DECKUP_BROWSER_CACHE_DIR`, or the platform default under your user cache directory) and re-run the command to trigger a fresh download.
Alternatively, set `DECKUP_BROWSER_CACHE_DIR` to a new, empty directory.
Do not run broad recursive deletes outside that directory.
