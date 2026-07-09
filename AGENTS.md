# AGENTS.md

- Deckup is an Astro-native slide deck CLI; user decks live in `slides/`, while `@deckup/cli` supplies the runtime.
- Use Vite+ (`vp`), not raw Vite/pnpm scripts: `vp install` after pulling, `vp run ready` before handoff when practical.
- For focused checks, prefer workspace commands such as `vp run @deckup/cli#test`, `vp run @deckup/cli#build`, or `vp run example#build`.
- `apps/cli/src/astro.ts` owns Astro inline config: keep `root`, `srcDir`, `configFile`, `output`, `outDir`, `logLevel`, and dev toolbar Deckup-controlled.
- `deckup.config.*` should expose only Deckup-supported config (`port`, `astro` minus owned fields); preserve the type tests that enforce this boundary.
- Runtime files in `apps/cli/runtime/` are copied into each deck’s `.deckup/runtime`; do not rely on editing generated `.deckup`, `.astro`, `dist`, or `node_modules` output.
- Slide loading is runtime-driven by `import.meta.glob("/slides/*.{astro,mdx}")`; keep browser behavior aligned between `deckup dev` and `deckup build`.
- When changing navigation, update `apps/cli/runtime/scripts/navigation.ts` plus `apps/cli/tests/navigation.test.ts`, then verify the `example/` deck if behavior is visual.
- Vite+ lint prefers imports from `vite-plus` / `vite-plus/test`; avoid bypassing the configured wrapper.
