# Edit an existing Deckup presentation

Follow this workflow when revising, extending, restyling, repairing, or exporting an existing deck.

## 1. Establish the baseline

1. Read the complete target deck at its actual project path, `deckup.config.*`, referenced components, CSS, images, and repository instructions before editing. Never assume the deck lives under `slides/`.
2. Identify the deck's format, active theme, available layouts, voice, audience, narrative, repeated visual patterns, and output expectations.
3. Translate the request into concrete acceptance criteria and affected slide numbers or sections.
4. Preserve the format, theme, voice, terminology, visual language, imports, and file organization unless the request requires a change.

## 2. Verify the existing rendering

1. Read [cli.md](cli.md) and [visual-review.md](visual-review.md).
2. For content or visual work, render the complete deck to a dedicated disposable PNG directory before editing.
3. Open every printed PNG in order. Record baseline defects separately from requested changes so the scope remains explicit.
4. If rendering fails, diagnose the source, configuration, dependencies, theme, and assets before making presentation changes.

## 3. Plan the smallest coherent change

1. Resolve the active theme in this order:
   1. Use the target deck's `theme` metadata when present: YAML frontmatter in MDX or a static `const theme = "..."` in Astro.
   2. Otherwise use the top-level `theme` from `deckup.config.*` when present.
   3. Otherwise use `default`.
2. Inspect the resolved theme's layouts and slots when a layout may change:

```bash
npx deckup inspect theme google-basic --json
```

3. Replace `google-basic` with the resolved theme name. The current CLI requires this positional name and does not infer it from the deck.
4. Read [syntax.md](syntax.md) before changing source syntax or configuration.
5. Decide whether each acceptance criterion requires copy edits, layout changes, new or removed slides, component changes, asset changes, or configuration changes.
6. Prefer local source edits over broad redesigns. Apply deck-wide changes only when consistency or the request requires them.
7. Keep slide titles, transitions, references, and conclusions coherent when changing narrative structure.

## 4. Edit and verify incrementally

1. Modify source decks, referenced components, CSS, assets, or configuration. Never patch generated output.
2. Re-render affected one-based slide numbers after each focused round:

```bash
npx deckup build presentation.mdx --format png --slides 3,7-9 --out /tmp/deckup-preview
```

3. Open the new PNGs and verify the requested change, clipping, hierarchy, alignment, contrast, and nearby consistency.
4. Re-render the complete deck whenever slides are inserted, deleted, or reordered because later slide numbers change.
5. Repeat until every acceptance criterion is met and no significant regression remains.

## 5. Perform the final pass

1. Render and reopen the complete deck in order.
2. Compare the final deck against the baseline and acceptance criteria.
3. Build only the requested PDF or static HTML outputs.
4. Report changed source paths, preserved conventions, commands and results, reviewed slide numbers, final output paths, fixed baseline defects, and unresolved limitations.
