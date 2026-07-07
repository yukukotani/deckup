import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://slida.yuku.dev",
  integrations: [
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
