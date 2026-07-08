import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import slida from "@slida/astro";

export default defineConfig({
  site: "https://slida.yuku.dev",
  integrations: [
    slida({ decks: "src/slides/*.{astro,mdx}", base: "/slides" }),
    starlight({
      title: "Slida",
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
