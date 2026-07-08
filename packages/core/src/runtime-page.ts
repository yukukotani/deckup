export const DEFAULT_DECK_LAYOUT_MODULE_ID = "../layouts/DeckLayout.astro";

export interface RuntimePageSourceOptions {
  deckLayoutModuleId?: string;
}

export function createRuntimePageSource(
  virtualDeckModuleId: string,
  options: RuntimePageSourceOptions = {},
) {
  const deckLayoutModuleId = options.deckLayoutModuleId ?? DEFAULT_DECK_LAYOUT_MODULE_ID;
  return `---
import DeckLayout from ${JSON.stringify(deckLayoutModuleId)};
import Deck, { deck } from ${JSON.stringify(virtualDeckModuleId)};

const deckTitle = typeof deck.frontmatter?.title === "string" ? deck.frontmatter.title : "Slida Deck";
---

<DeckLayout slideCount={deck.pageCount} title={deckTitle}>
  {
    deck.pageCount > 0 ? (
      <main class="slida-deck" data-slida-deck aria-label="Slide deck">
        <Deck />
      </main>
    ) : (
      <main class="slida-empty" data-slida-empty>
        <p class="slida-kicker">No slides found</p>
        <h1>Create your first page</h1>
        <p>
          Add at least one <code>&lt;Page&gt;</code> to <code>{deck.projectRelativePath}</code>, then restart or refresh
          the preview.
        </p>
      </main>
    )
  }
</DeckLayout>
`;
}
