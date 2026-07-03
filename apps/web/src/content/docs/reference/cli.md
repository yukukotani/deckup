---
title: CLI reference
description: Command syntax and options for slida dev, slida build, and slida export.
---

# CLI reference

The `slida` command currently provides three workflows:

- `slida dev <deck-file>` previews a deck with Astro's dev server.
- `slida build <deck-file>` builds static HTML and assets.
- `slida export <deck-file>` builds the deck and writes a PDF.

Deck files can be `.astro` or `.mdx`.
All commands accept Astro log levels through `--logLevel`; unsupported values fall back to `info`.

## `slida dev`

Preview a deck locally:

```bash
slida dev slides/deck.mdx
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

Build a static web version of a deck:

```bash
slida build slides/deck.mdx
```

### Arguments

| Argument    | Required | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `deck-file` | Yes      | Deck file to build (`.astro` or `.mdx`). |

### Options

| Option               | Default | Description              |
| -------------------- | ------- | ------------------------ |
| `--outDir <dir>`     | `dist`  | Static output directory. |
| `--logLevel <level>` | `info`  | Astro log level.         |

## `slida export`

Export a deck to PDF:

```bash
slida export slides/deck.mdx
```

### Arguments

| Argument    | Required | Description                               |
| ----------- | -------- | ----------------------------------------- |
| `deck-file` | Yes      | Deck file to export (`.astro` or `.mdx`). |

### Options

| Option               | Default                   | Description                                           |
| -------------------- | ------------------------- | ----------------------------------------------------- |
| `--out <file>`       | Deck basename with `.pdf` | PDF output file.                                      |
| `--outDir <dir>`     | `dist`                    | Static build output directory used before PDF export. |
| `--force`, `-f`      | `false`                   | Overwrite an existing PDF without prompting.          |
| `--logLevel <level>` | `info`                    | Astro log level.                                      |

If the target PDF already exists, Slida asks before overwriting in an interactive terminal.
In non-interactive mode, rerun with `--force` to overwrite an existing file.

## Root command

Running `slida` without a subcommand prints a short reminder to use `slida dev <deck-file>`, `slida build <deck-file>`, or `slida export <deck-file>`.
