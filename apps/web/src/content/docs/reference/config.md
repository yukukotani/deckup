---
title: Configuration reference
description: Supported Slida config files, public config fields, and Astro config boundaries.
---

# Configuration reference

Slida looks for one config file in the project root.
If no config file exists, Slida uses an empty config.
If multiple config files exist, Slida stops and asks you to keep only one.

## Supported filenames

Slida supports these filenames:

- `slida.config.ts`
- `slida.config.js`
- `slida.config.mjs`
- `slida.config.mts`
- `slida.config.cjs`
- `slida.config.cts`

The config file must default-export a plain object.
Use `defineConfig()` for TypeScript help:

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "@slida/cli";

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
| `astro` | `AstroInlineConfig` subset | Extra Astro config Slida allows users to provide.                                                                                                                    |

## Astro boundary

Slida owns the runtime Astro fields that are required to build and preview decks.
Do not configure these fields through `slida.config.*`:

- `root`
- `srcDir`
- `configFile`
- `output`
- `server`
- `outDir`
- `logLevel`
- `devToolbar`

Slida also strips nested Vite `root` from user-provided `astro.vite` config.
User Vite plugins and aliases are appended after Slida's required runtime plugins and aliases.

## CLI precedence

For `slida open`, the dev-server port is resolved in this order:

1. `--port` or `-p` from the command line.
2. `port` from `slida.config.*`.
3. Slida's default port, `4321`.

For deck themes, Slida resolves the effective theme in this order:

1. The deck file's top-level theme metadata.
2. `theme` from `slida.config.*`.
3. Slida's default theme, `default`.

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
