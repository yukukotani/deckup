---
title: Configuration reference
description: Supported Deckup config files, public config fields, and Astro config boundaries.
---

# Configuration reference

Deckup looks for one config file in the project root.
If no config file exists, Deckup uses an empty config.
If multiple config files exist, Deckup stops and asks you to keep only one.

## Supported filenames

Deckup supports these filenames:

- `deckup.config.ts`
- `deckup.config.js`
- `deckup.config.mjs`
- `deckup.config.mts`
- `deckup.config.cjs`
- `deckup.config.cts`

The config file must default-export a plain object.
Use `defineConfig()` for TypeScript help:

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "deckup";

export default defineConfig({
  port: 4321,
  theme: "google-basic",
  astro: {
    vite: {
      resolve: {
        alias: {
          "@slides": fileURLToPath(new URL("./slides", import.meta.url)),
        },
      },
    },
  },
});
```

## Public fields

| Field   | Type                       | Description                                                                                                                                                          |
| ------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`  | `number`                   | Default dev-server port. A CLI `--port` value overrides this.                                                                                                        |
| `theme` | `string`                   | Fallback theme for decks that do not declare their own theme. Supports built-in names, installed npm package specifiers, or auto-downloaded `npm:package[@version]`. |
| `astro` | `AstroInlineConfig` subset | Extra Astro config Deckup allows users to provide.                                                                                                                   |

## Astro boundary

Deckup owns the runtime Astro fields that are required to build and preview decks.
Do not configure these fields through `deckup.config.*`:

- `root`
- `srcDir`
- `configFile`
- `output`
- `server`
- `outDir`
- `logLevel`
- `devToolbar`

Deckup also strips nested Vite `root` from user-provided `astro.vite` config.
User Vite plugins and aliases are appended after Deckup's required runtime plugins and aliases.

## CLI precedence

For `deckup open`, the dev-server port is resolved in this order:

1. `--port` or `-p` from the command line.
2. `port` from `deckup.config.*`.
3. Deckup's default port, `4321`.

For deck themes, Deckup resolves the effective theme in this order:

1. The deck file's top-level theme metadata.
2. `theme` from `deckup.config.*`.
3. Deckup's default theme, `default`.

In MDX decks, use YAML frontmatter:

```mdx
---
theme: minimal
---
```

In Astro decks, use a static top-level constant in the frontmatter script:

```astro
---
const theme = "bold";
---
```

Deck theme metadata must be a static string.
