---
title: React
description: Add the official Astro React integration to an existing Deckup project and use interactive React components in slides.
---

This guide starts with an existing Deckup project that can already open a deck.
Deckup passes standard Astro integrations through to both `.astro` and `.mdx` decks, so React uses the official Astro integration rather than a Deckup-specific adapter.

## Install the React integration

From the Deckup project, install the integration and React runtime:

```bash
npm install @astrojs/react react react-dom
npm install -D @types/react @types/react-dom
```

## Add the integration to Deckup

Import `@astrojs/react` in the existing `deckup.config.ts`, then add it to `astro.integrations`:

```ts
import react from "@astrojs/react";
import { defineConfig } from "deckup";

export default defineConfig({
  astro: {
    integrations: [react()],
  },
});
```

Keep any other Deckup or Astro options already present in the configuration.

## Create a React component

Create `slides/components/ReactRange.tsx`:

```tsx
import { useState } from "react";

export default function ReactRange() {
  const [value, setValue] = useState(50);

  return (
    <label>
      Selected value: <output>{value}%</output>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
      />
      <svg viewBox="0 0 100 20" role="img" aria-label={`Selected value ${value}%`}>
        <rect x="0" y="4" width={value} height="12" fill="currentColor" />
      </svg>
    </label>
  );
}
```

## Use React in an Astro deck

Import the component in frontmatter and add `client:load` to hydrate it when the slide loads:

```astro
---
import Page from "@deckup/astro/page";
import ReactRange from "./components/ReactRange.tsx";
---

<Page title="React range" layout="page">
  <h1>React range</h1>
  <ReactRange client:load />
</Page>
```

## Use React in an MDX deck

Import and render the same component in an MDX deck:

```mdx
import ReactRange from "./components/ReactRange.tsx";

<PageMeta layout="page" />

# React range

<ReactRange client:load />
```

Without a `client:*` directive, Astro renders the component HTML on the server but does not attach browser event handlers.
Use `client:load` here because the control should be interactive immediately.

## Preview the result

Open the deck you edited:

```bash
npx deckup open slides/deck.astro
# or
npx deckup open slides/deck.mdx
```

Open the [live React data explorer](/slides/component-showcase#2), then compare the equivalent [Vue integration](/integrations/vue/).
Return to [Writing Slides](/guides/writing-slides/) for Page, PageMeta, layout, and visual-review guidance.
