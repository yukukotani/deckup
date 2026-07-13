export interface DeckLayoutSourceOptions {
  cssModuleId: string;
  additionalCssModuleIds?: string[];
  navigationModuleId: string;
}

export function createDeckLayoutSource(options: DeckLayoutSourceOptions) {
  const cssImports = [options.cssModuleId, ...(options.additionalCssModuleIds ?? [])]
    .map((moduleId) => `import ${JSON.stringify(moduleId)};`)
    .join("\n");
  const navigationImport = JSON.stringify(options.navigationModuleId);

  return `---
${cssImports}

interface Props {
  slideCount: number;
  title?: string;
}

const { slideCount, title = "Deckup Deck" } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="generator" content="Deckup" />
    <title>{title}</title>
  </head>
  <body>
    <div class="deckup-shell" data-deckup-shell data-slide-count={slideCount}>
      <slot />
    </div>
    <nav class="deckup-navigation deckup-status" data-deckup-navigation aria-label="Slide navigation">
      <button
        type="button"
        class="deckup-navigation__handle"
        data-deckup-nav-drag-handle
        aria-label="Move navigation menu"
        title="Move navigation menu"
      >
        ⋮⋮
      </button>
      <button
        type="button"
        class="deckup-navigation__button"
        data-deckup-nav-prev
        aria-label="Previous slide"
        disabled
      >
        ‹
      </button>
      <span class="deckup-navigation__status" aria-live="polite">
        <span data-deckup-current>1</span>/<span data-deckup-total>{Math.max(slideCount, 1)}</span>
      </span>
      <button
        type="button"
        class="deckup-navigation__button"
        data-deckup-nav-next
        aria-label="Next slide"
        disabled={slideCount <= 1}
      >
        ›
      </button>
      <button
        type="button"
        class="deckup-navigation__button"
        data-deckup-nav-fullscreen
        aria-label="Enter fullscreen"
        aria-pressed="false"
        title="Enter fullscreen"
      >
        ⛶
      </button>
    </nav>
    <script>
      import ${navigationImport};
    </script>
  </body>
</html>
`;
}
