---
title: CLI reference
description: Command syntax and options for deckup open and deckup build output formats.
---

# CLI reference

The `deckup` command provides two workflows:

- `deckup open <deck-file>` previews a deck with Astro's dev server.
- `deckup build <deck-file>` builds a deck as PDF by default, or as static HTML/assets with `--format html`.

Deck files can be `.astro` or `.mdx`.
All commands accept Astro log levels through `--logLevel`; unsupported values fall back to `info`.

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

### Arguments

| Argument    | Required | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `deck-file` | Yes      | Deck file to build (`.astro` or `.mdx`). |

### Options

| Option                 | Default                               | Description                                                             |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `--format <html\|pdf>` | `pdf`                                 | Output format. Use `html` for static HTML/assets or `pdf` for PDF.      |
| `--out <path>`         | Deck basename (`deck/` or `deck.pdf`) | Output PDF file for `pdf`, or static output directory for `html`.       |
| `--force`, `-f`        | `false`                               | Overwrite an existing PDF without prompting. Only affects `pdf` output. |
| `--logLevel <level>`   | `info`                                | Astro log level.                                                        |

PDF output uses an internal static build staging directory before writing the PDF; that staging directory is not part of the public CLI surface.
If the target PDF already exists, Deckup asks before overwriting in an interactive terminal.
In non-interactive mode, rerun with `--force` to overwrite an existing PDF.

## Root command

Running `deckup` without a subcommand prints a short reminder to use `deckup open <deck-file>` or `deckup build <deck-file>`.
