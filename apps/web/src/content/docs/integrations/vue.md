---
title: Vue
description: Add the official Astro Vue integration to an existing Deckup project and use interactive Vue components in slides.
---

This guide starts with an existing Deckup project that can already open a deck.
Deckup passes standard Astro integrations through to both `.astro` and `.mdx` decks, so Vue uses the official Astro integration rather than a Deckup-specific adapter.

## Install the Vue integration

From the Deckup project, install the integration and Vue runtime:

```bash
npm install @astrojs/vue vue
```

## Add the integration to Deckup

Import `@astrojs/vue` in the existing `deckup.config.ts`, then add it to `astro.integrations`:

```ts
import vue from "@astrojs/vue";
import { defineConfig } from "deckup";

export default defineConfig({
  astro: {
    integrations: [vue()],
  },
});
```

Keep any other Deckup or Astro options already present in the configuration.

## Create a Vue component

Create `slides/components/VueRange.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";

const value = ref(50);
</script>

<template>
  <label>
    Selected value: <output>{{ value }}%</output>
    <input v-model.number="value" type="range" min="0" max="100" />
    <svg viewBox="0 0 100 20" role="img" :aria-label="`Selected value ${value}%`">
      <rect x="0" y="4" :width="value" height="12" fill="currentColor" />
    </svg>
  </label>
</template>
```

## Use Vue in an Astro deck

Import the component in frontmatter and add `client:load` to hydrate it when the slide loads:

```astro
---
import Page from "@deckup/astro/page";
import VueRange from "./components/VueRange.vue";
---

<Page title="Vue range">
  <PageMeta layout="page" />
  <h1>Vue range</h1>
  <VueRange client:load />
</Page>
```

## Use Vue in an MDX deck

Import and render the same component in an MDX deck:

```mdx
import VueRange from "./components/VueRange.vue";

<PageMeta layout="page" />

# Vue range

<VueRange client:load />
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

Open the [live Vue data explorer](/slides/component-showcase#3), then compare the equivalent [React integration](/integrations/react/).
Return to [Writing Slides](/guides/writing-slides/) for Page, PageMeta, layout, and visual-review guidance.
