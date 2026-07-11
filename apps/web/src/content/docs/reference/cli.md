---
title: CLI reference
description: Command syntax and options for deckup open and deckup build output formats.
---

The `deckup` command provides two workflows:

- `deckup open <deck-file>` previews a deck with Astro's dev server.
- `deckup build <deck-file>` builds a deck as PDF by default, as static HTML/assets with `--format html`, or as PNG images with `--format png`.

Deck files can be `.astro` or `.mdx`.
Commands accept Astro log levels through `--logLevel`; unsupported values fall back to `info`.
PNG builds keep Astro logging silent so successful stdout contains only generated image paths.

## `deckup open`

Preview a deck locally:

```bash
deckup open slides/deck.mdx
```

### Arguments

| Argument    | Required | Description                                |
| ----------- | -------- | ------------------------------------------ |
| `deck-file` | Yes      | Deck file to preview (`.astro` or `.mdx`). |

### Options

| Option                       | Default                           | Description                                  |
| ---------------------------- | --------------------------------- | -------------------------------------------- |
| `--host <host>`              | `127.0.0.1`                       | Host for the Astro dev server.               |
| `--port <port>`, `-p <port>` | Deckup config `port`, then `4321` | Port for the Astro dev server.               |
| `--open`                     | `false`                           | Open the browser when the dev server starts. |
| `--logLevel <level>`         | `info`                            | Astro log level.                             |

When the server starts, Deckup prints the local URL.

## `deckup build`

Build a deck. The default output format is PDF:

```bash
deckup build slides/deck.mdx
```

Build static HTML and assets explicitly with `--format html`:

```bash
deckup build slides/deck.mdx --format html --out public-deck
```

Render selected slides as PNG images with `--format png` and `--slides`:

```bash
deckup build slides/deck.mdx --format png --slides 1,3-5 --out rendered-slides
```

### Arguments

| Argument    | Required | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `deck-file` | Yes      | Deck file to build (`.astro` or `.mdx`). |

### Options

| Option                      | Default                                      | Description                                                                                    |
| --------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `--format <html\|pdf\|png>` | `pdf`                                        | Output format: static HTML/assets, PDF, or PNG images.                                         |
| `--out <path>`              | Format-dependent (`deck/` or `deck.pdf`)     | Output PDF file for `pdf`; output directory for `html` and `png`.                              |
| `--slides <selection>`      | All slides                                   | PNG-only one-based numbers, comma lists, and inclusive ranges such as `1,3-5`.                 |
| `--force`, `-f`             | `false`                                      | Overwrite an existing PDF without prompting; ignored for HTML and PNG output.                  |
| `--logLevel <level>`        | `info` (`silent` is enforced for PNG output) | Astro log level. PNG stays silent so stdout remains a machine-readable list of absolute paths. |

PDF output uses an internal static build staging directory before writing the PDF; that staging directory is not part of the public CLI surface.
If the target PDF already exists, Deckup asks before overwriting in an interactive terminal.
In non-interactive mode, rerun with `--force` to overwrite an existing PDF.

### PNG output

PNG selection is one-based and follows the visible Deckup slide numbers.
A value such as `3,1,3-4` is de-duplicated and rendered in deck order as slides 1, 3, and 4.
Omitting `--slides` renders every slide.
Using `--slides` with HTML or PDF output is an error.
Malformed, non-positive, reversed, or out-of-range selections fail before the PNG output directory is changed.

PNG `--out` is always a directory.
When omitted, it defaults to the deck file's extensionless basename under the project root, so `slides/deck.mdx` writes to `deck/`.
A valid PNG build replaces the accepted output directory in full, including non-PNG files left there from earlier work.
Deckup rejects filesystem roots, the project root, directories containing the source deck, symlink-equivalent dangerous paths, and paths overlapping the internal static build directory.
A safe absolute directory outside the project, such as `/tmp/deckup-png`, is allowed.

Images are named `slide-NNN.png`, use one-based zero-padded numbers, and contain only the active slide at 1600×900 pixels.
Deckup builds once and reuses one Chromium browser and page while switching slides through the existing hash navigation contract.
On success, stdout contains only each generated image's absolute path, one per line in deck order.
The static HTML staging output remains in `dist/`, as it does for PDF export.

## Root command

Running `deckup` without a subcommand prints a short reminder to use `deckup open <deck-file>` or `deckup build <deck-file>`.
