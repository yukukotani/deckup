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
          label: "Start Here",
          items: [
            { label: "Quickstart", slug: "quickstart" },
            { label: "Deck authoring", slug: "concepts/deck-authoring" },
          ],
        },
        {
          label: "Slides",
          items: [
            { label: "Intro deck", link: "/slides/intro" },
            { label: "Guide deck", link: "/slides/guide" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "reference/cli" },
            { label: "Configuration", slug: "reference/config" },
            { label: "Themes", slug: "reference/themes" },
          ],
        },
      ],
    }),
  ],
});
