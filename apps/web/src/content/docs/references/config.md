---
title: Config
description: Configure Deckup defaults, built-in integrations, and supported Astro options.
---

Deckup loads one configuration file from the project root.
Supported filenames are:

- `deckup.config.ts`
- `deckup.config.js`
- `deckup.config.mjs`
- `deckup.config.mts`
- `deckup.config.cjs`
- `deckup.config.cts`

The configuration file must default-export an object.
Only one supported config file can exist in a project; Deckup reports an error when it finds more than one.

Use `defineConfig()` for type checking and editor completion:

```ts
import { defineConfig } from "deckup";

export default defineConfig({
  port: 4321,
  theme: "google-basic",
  integrations: {
    tailwind: {
      optimize: { minify: false },
    },
  },
  astro: {
    vite: {
      resolve: {
        alias: { "@slides": "/absolute/path/to/slides" },
      },
    },
  },
});
```

## Options

| Field          | Type                                            | Description                                               |
| -------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `port`         | `number`                                        | Default development server port. CLI `--port` wins.       |
| `theme`        | `string`                                        | Fallback built-in, installed, or `npm:` theme.            |
| `integrations` | `{ tailwind?: DeckupTailwindOptions \| false }` | Known Deckup built-ins. Tailwind is enabled when omitted. |
| `astro`        | `AstroInlineConfig` subset                      | Additional supported Astro configuration.                 |

## `port`

Set the default port used by `deckup open`:

```ts
export default defineConfig({
  port: 3000,
});
```

The `--port` CLI option takes precedence over this value.
When neither is set, Deckup uses port `4321`.

## `theme`

Set the fallback theme used when a deck does not declare one in its static metadata:

```ts
export default defineConfig({
  theme: "minimal",
});
```

Deck metadata takes precedence over this value.
When neither is set, Deckup uses `default`.
See the [Theme reference](/references/theme/) for built-in, installed, and registry themes.

## `integrations`

Deckup provides built-in integrations that are configured separately from Astro integrations.
Tailwind CSS v4 is currently the only built-in integration.

### `integrations.tailwind`

Tailwind is enabled when `integrations.tailwind` is omitted, so Astro and MDX decks can use utility classes without installing packages or importing CSS.
Pass an `@tailwindcss/vite` options object to configure its Vite plugin:

```ts
export default defineConfig({
  integrations: {
    tailwind: {
      optimize: { minify: false },
    },
  },
});
```

Set it to `false` to remove Deckup's built-in Tailwind plugins and generated stylesheet:

```ts
export default defineConfig({
  integrations: {
    tailwind: false,
  },
});
```

Built-in plugins run before plugins from `astro.vite.plugins`.
Manual Tailwind plugins in that list are not de-duplicated.
This option applies to the Deckup CLI; projects that host `@deckup/astro` configure styling in their own Astro setup.

## `astro`

Use `astro` to pass supported Astro inline configuration to Deckup.
For example, install and register an Astro integration:

```ts
import react from "@astrojs/react";
import { defineConfig } from "deckup";

export default defineConfig({
  astro: {
    integrations: [react()],
  },
});
```

Deckup owns the Astro options required to provide the slide runtime and consistent development and build behavior.
The following fields are therefore not available under `astro`:

- `root`
- `srcDir`
- `configFile`
- `output`
- `server`
- `outDir`
- `logLevel`
- `devToolbar`

Nested `astro.vite.root` is ignored as well.
Use the Deckup CLI options for server and output settings.
See the [React](/integrations/react/) and [Vue](/integrations/vue/) guides for complete integration examples.
