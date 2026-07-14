import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import vue from "@astrojs/vue";
import deckup from "@deckup/astro";

export default defineConfig({
  site: "https://deckup.yuku.dev",
  vite: {
    server: {
      fs: {
        allow: [fileURLToPath(new URL("../..", import.meta.url))],
      },
    },
  },
  integrations: [
    react(),
    vue(),
    deckup({ decks: "src/slides/*.{astro,mdx}", base: "/slides" }),
    starlight({
      title: "Deckup",
      sidebar: [
        {
          label: "Introduction",
          items: [
            { label: "Introduction", link: "/" },
            {
              label: "Getting Started",
              slug: "introduction/getting-started",
            },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Writing Slides", slug: "guides/writing-slides" },
            {
              label: "Authoring Themes",
              slug: "guides/authoring-themes",
            },
            { label: "Working with AI", slug: "guides/working-with-ai" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { label: "React", slug: "integrations/react" },
            { label: "Vue", slug: "integrations/vue" },
          ],
        },
        {
          label: "References",
          items: [
            { label: "CLI", slug: "references/cli" },
            { label: "Config", slug: "references/config" },
            { label: "Syntax", slug: "references/syntax" },
            { label: "Theme", slug: "references/theme" },
          ],
        },
      ],
    }),
  ],
});
