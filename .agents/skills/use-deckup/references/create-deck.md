# Create a new Deckup presentation

Follow this workflow only for a genuinely new deck.

## 1. Establish the presentation contract

1. Derive the audience, purpose, central conclusion, expected duration, language, and required outputs from the request.
2. Ask only for missing information that would materially change the result. Otherwise state reasonable assumptions through the work itself.
3. Turn source material into claims and supporting evidence. Do not invent facts, metrics, quotations, examples, or citations.

## 2. Inspect the project

1. Read repository instructions and inspect existing Deckup `.mdx` and `.astro` sources wherever the project stores them, along with `deckup.config.*`, components, CSS, images, and package dependencies.
2. Reuse established naming, imports, theme choices, asset locations, and visual conventions when the project already contains decks.
3. Choose `.mdx` for Markdown-led content and standard layouts. Choose `.astro` for component-heavy slides, precise HTML, or complex slot composition.
4. Use the source path requested by the user. Otherwise follow the project's established deck location; if none exists, choose a clear project-local path and report it. Never assume decks must live under `slides/`.

## 3. Select the theme and layouts

1. Resolve the selected theme from deck metadata first, then `deckup.config.*`, then the `default` fallback.
2. Inspect its actual public layouts and slots before outlining slides:

```bash
npx deckup inspect theme google-basic --json
```

3. Replace `google-basic` with the resolved theme name. The current CLI requires this positional name and does not infer it from a deck. Install a third-party theme in the deck project before inspecting or using it.
4. Prefer theme-provided layouts, typography, and spacing. Add only the minimum custom styling needed for the content.

## 4. Design the narrative

1. Write the deck's conclusion in one sentence.
2. Build a title-only outline whose logic is understandable without body content.
3. Structure the default arc as opening → context or problem → evidence and development → conclusion → next action. Adapt it when the genre requires another structure.
4. Assign one primary claim and one content-appropriate layout to each slide.
5. Vary layouts to create rhythm, but never select a layout merely for decoration.

## 5. Author the source

1. Read [syntax.md](syntax.md) and use only supported Deckup syntax.
2. For a suitable MDX deck, copy [../assets/starter-deck.mdx](../assets/starter-deck.mdx) as a starting point and replace every placeholder. Otherwise author the source directly.
3. Edit prose for projection: shorten paragraphs, flatten deep lists, limit code, and make headings specific.
4. Give images meaningful alternative text, preserve aspect ratio, and add attribution where required.
5. Keep configuration changes minimal and avoid creating a second `deckup.config.*` file.

## 6. Render and refine

1. Read [cli.md](cli.md) and [visual-review.md](visual-review.md).
2. Render every slide to a dedicated disposable directory:

```bash
npx deckup build presentation.mdx --format png --out /tmp/deckup-preview
```

3. Open every printed PNG path in order and review both individual slides and the narrative sequence.
4. Fix source, component, CSS, or asset issues. Re-render and reopen changed one-based slide numbers while iterating:

```bash
npx deckup build presentation.mdx --format png --slides 2,4-6 --out /tmp/deckup-preview
```

5. Re-render and reopen the complete deck after the targeted loop, especially after adding, deleting, or reordering slides.

## 7. Build and report

1. Build only the requested PDF or static HTML outputs after the final visual pass.
2. Report the created source and asset paths, selected format and theme, commands and results, reviewed slides, final output paths, assumptions, and unresolved limitations.
