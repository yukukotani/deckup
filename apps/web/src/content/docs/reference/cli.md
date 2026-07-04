---
title: CLI reference
description: Command syntax and options for slida open and slida build output formats.
---

# CLI reference

The `slida` command provides two workflows:

- `slida open <deck-file>` previews a deck with Astro's dev server.
- `slida build <deck-file>` builds a deck as PDF by default, or as static HTML/assets with `--format html`.

Deck files can be `.astro` or `.mdx`.
All commands accept Astro log levels through `--logLevel`; unsupported values fall back to `info`.

## `slida open`

Preview a deck locally:

```bash
slida open slides/deck.mdx
```

### Arguments

| Argument    | Required | Description                                |
| ----------- | -------- | ------------------------------------------ |
| `deck-file` | Yes      | Deck file to preview (`.astro` or `.mdx`). |

### Options

| Option                       | Default                          | Description                                  |
| ---------------------------- | -------------------------------- | -------------------------------------------- |
| `--host <host>`              | `127.0.0.1`                      | Host for the Astro dev server.               |
| `--port <port>`, `-p <port>` | Slida config `port`, then `4321` | Port for the Astro dev server.               |
| `--open`                     | `false`                          | Open the browser when the dev server starts. |
| `--logLevel <level>`         | `info`                           | Astro log level.                             |

When the server starts, Slida prints the local URL.

## `slida build`

Build a deck. The default output format is PDF:

```bash
slida build slides/deck.mdx
```

Build static HTML and assets explicitly with `--format html`:

```bash
slida build slides/deck.mdx --format html --out public-deck
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
If the target PDF already exists, Slida asks before overwriting in an interactive terminal.
In non-interactive mode, rerun with `--force` to overwrite an existing PDF.

## Root command

Running `slida` without a subcommand prints a short reminder to use `slida open <deck-file>` or `slida build <deck-file>`.
