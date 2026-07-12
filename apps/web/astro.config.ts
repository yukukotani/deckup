import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import deckup from "@deckup/astro";

export default defineConfig({
  site: "https://deckup.yuku.dev",
  integrations: [
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
          label: "References",
          items: [
            { label: "CLI", slug: "references/cli" },
            { label: "Syntax", slug: "references/syntax" },
            { label: "Theme", slug: "references/theme" },
          ],
        },
      ],
    }),
  ],
});
