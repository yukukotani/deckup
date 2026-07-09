# Plan 005: Stop re-parsing theme layouts on every virtual-module load

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c7aa912..HEAD -- apps/cli/src/deckup-vite-plugins.ts apps/cli/src/theme-layouts.ts apps/cli/tests/`
> Changes from Plans 001-004 are EXPECTED (Plan 004 moved shared AST helpers
> to `astro-ast.ts`/`utils.ts`). Locate every excerpt below by symbol name,
> not line number. If a named function no longer exists or its body differs
> materially from the excerpt, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/004-consolidate-duplicated-utilities.md (same files; execute after to avoid conflicts)
- **Category**: perf
- **Planned at**: commit `c7aa912`, 2026-07-02

## Why this matters

Every load of either Deckup virtual module (`virtual:deckup/theme-layouts` and
`virtual:deckup/deck`) — which happens on every HMR trigger for the deck or
theme during `deckup dev` — calls `refreshThemeRuntime`, which re-runs
`discoverThemeLayouts`: a `readdir` plus a **sequential** `readFile` + full
`@astrojs/compiler-rs` parse of every layout `.astro` file, and then
unconditionally rewrites the generated `Page.astro` file even when nothing
changed. With the two plugins both refreshing, a single save re-parses the
whole theme twice and re-writes a file inside the Astro `srcDir`. This plan
(a) parallelizes the per-layout work, (b) adds a fingerprint-validated cache
so unchanged themes skip the read+parse entirely, and (c) skips the generated
Page write when its content is unchanged.

## Current state

Relevant files:

- `apps/cli/src/theme-layouts.ts` — `discoverThemeLayouts` (exported; also
  used by `theme.ts` for the initial resolve).
- `apps/cli/src/deckup-vite-plugins.ts` — `refreshThemeLayouts`,
  `writeFreshGeneratedPage`, `refreshThemeRuntime`, and the three plugin
  factories that call them.
- `apps/cli/tests/` — there are currently NO direct tests for
  `discoverThemeLayouts` (only indirect coverage via `buildDeck` fixtures in
  `astro.test.ts`, e.g. the theme-layout tests around lines 180-230).

The sequential discovery loop as it exists today:

```ts
// apps/cli/src/theme-layouts.ts — discoverThemeLayouts (tail)
const layouts: DeckupResolvedThemeLayout[] = [];
for (const entry of layoutFiles) {
  const id = layoutIdFromFileName(entry.name);
  assertValidDeckupLayoutId(id, `${themeName} theme layout ${entry.name}`);
  const filePath = join(layoutsDir, entry.name);
  await assertReadableAstroLayout(themeName, id, filePath);
  const source = await readFile(filePath, "utf8");
  layouts.push({
    id,
    filePath,
    importPath: toViteFsImportPath(filePath),
    slotNames: extractAstroSlotNames(source, filePath),
  });
}

return layouts;
```

The refresh path in `deckup-vite-plugins.ts`:

```ts
// deckup-vite-plugins.ts — refreshThemeLayouts (abridged)
async function refreshThemeLayouts(theme?: DeckupResolvedTheme): Promise<DeckupResolvedTheme | undefined> {
  if (!theme) return undefined;
  if (!hasThemeLayouts(theme) || !theme.layoutsDir) return theme;
  try {
    const layouts = await discoverThemeLayouts(theme.name, theme.layoutsDir);
    return { ...theme, layouts, slotNames: uniqueStrings(layouts.flatMap((l) => l.slotNames)).sort() };
  } catch (error) {
    if (error instanceof Error && error.message.includes("must include a readable layouts directory")) {
      return theme;
    }
    throw error;
  }
}

// deckup-vite-plugins.ts — writeFreshGeneratedPage (abridged)
async function writeFreshGeneratedPage(theme, options) {
  if (!theme || !hasThemeLayouts(theme) || !options.generatedPageFilePath) return;
  await mkdir(dirname(options.generatedPageFilePath), { recursive: true });
  await writeFile(options.generatedPageFilePath, createGeneratedPageComponentSource(...));
}

// deckup-vite-plugins.ts — refreshThemeRuntime
async function refreshThemeRuntime(theme, options) {
  const refreshedTheme = await refreshThemeLayouts(theme);
  await writeFreshGeneratedPage(refreshedTheme, options);
  return refreshedTheme;
}
```

Callers of the refresh path (all must keep working):

- `createVirtualThemeLayoutsPlugin` → `refreshThemeRuntime` in `load()`
- `createVirtualDeckPlugin` → `refreshThemeRuntime` in `load()`
- `createAstroDeckValidationPlugin` → `refreshThemeLayouts` in `transform()`
- `createDeckupVitePlugins(deck, theme, options)` constructs all three — this
  is the natural place to create one shared cache per dev-server/build run.

Behavioral contracts that MUST NOT change:

- The `error.message.includes("must include a readable layouts directory")`
  fallback in `refreshThemeLayouts` stays exactly as-is (audit finding #10
  was explicitly NOT selected for fixing; do not "improve" it here).
- Dev watching: `addWatchFile` calls on `layoutsDir` and each layout file
  (in `addThemeLayoutWatchFiles`) stay — Vite invalidates the virtual
  modules when those files change, which then must yield FRESH results, so
  the cache must be validated by filesystem state, not time.
- `discoverThemeLayouts`'s error messages and sort order
  (`localeCompare` on file names) are pinned by `astro.test.ts` fixtures.

Repo conventions: tests import from `vite-plus/test`; intra-package imports
use explicit `.ts` extensions.

## Commands you will need

| Purpose          | Command                   | Expected on success                                                                        |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| Install          | `vp install`              | exit 0                                                                                     |
| CLI tests        | `vp run @deckup/cli#test` | exit 0, all pass                                                                           |
| Lint/fmt/types   | `vp check`                | exit 0                                                                                     |
| Full gate        | `vp run ready`            | exit 0                                                                                     |
| Manual HMR check | `vp run example#dev`      | dev server starts; edits to `packages/theme-google-basic/layouts/*.astro` still hot-reload |

## Scope

**In scope** (the only files you should modify/create):

- `apps/cli/src/theme-layouts.ts`
- `apps/cli/src/deckup-vite-plugins.ts`
- `apps/cli/tests/theme-layouts.test.ts` (create)

**Out of scope** (do NOT touch):

- The error-substring fallback in `refreshThemeLayouts` (see contracts).
- `apps/cli/src/theme.ts` — the one-shot initial resolve does not need the
  cache.
- `apps/cli/src/runtime.ts` `prepareRuntime` rm+cp (audit finding rejected
  as minor; separate concern).
- `apps/cli/src/index.ts` — any new exports for tests are imported directly
  from source files by tests, not added to the public surface.

## Git workflow

- Branch: `advisor/005-cache-theme-layout-discovery`
- Commit style: short imperative subject. Suggested: `Cache theme layout discovery across virtual module loads`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Parallelize `discoverThemeLayouts`

In `apps/cli/src/theme-layouts.ts`, replace the sequential tail loop with:

```ts
return Promise.all(
  layoutFiles.map(async (entry) => {
    const id = layoutIdFromFileName(entry.name);
    assertValidDeckupLayoutId(id, `${themeName} theme layout ${entry.name}`);
    const filePath = join(layoutsDir, entry.name);
    await assertReadableAstroLayout(themeName, id, filePath);
    const source = await readFile(filePath, "utf8");
    return {
      id,
      filePath,
      importPath: toViteFsImportPath(filePath),
      slotNames: extractAstroSlotNames(source, filePath),
    };
  }),
);
```

`Promise.all` preserves input order, so the `localeCompare` sort on
`layoutFiles` still determines output order. Note one deliberate behavior
nuance: with parallel execution, when MULTIPLE layouts are invalid, which
error surfaces first is no longer strictly the alphabetically-first one —
each individual error message is unchanged. The existing `astro.test.ts`
fixtures use single-error cases, so this is safe; verify.

**Verify**: `vp run @deckup/cli#test` → exit 0.

### Step 2: Add a fingerprint-validated discovery cache

In `apps/cli/src/theme-layouts.ts`, add (and export for direct testing):

```ts
import { readdir, stat } from "node:fs/promises"; // stat is new; readdir already imported

async function fingerprintLayoutsDir(layoutsDir: string) {
  const entries = await readdir(layoutsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && extname(e.name) === ".astro" && !e.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stats = await Promise.all(
    files.map(async (e) => {
      const s = await stat(join(layoutsDir, e.name));
      return `${e.name}:${s.mtimeMs}:${s.size}`;
    }),
  );
  return stats.join("|");
}

export function createThemeLayoutDiscoveryCache() {
  let cached:
    | { layoutsDir: string; fingerprint: string; layouts: DeckupResolvedThemeLayout[] }
    | undefined;

  return async function discoverCached(themeName: string, layoutsDir: string) {
    let fingerprint: string | undefined;
    try {
      fingerprint = await fingerprintLayoutsDir(layoutsDir);
    } catch {
      // Fall through: let discoverThemeLayouts produce its canonical error.
    }
    if (
      fingerprint !== undefined &&
      cached?.layoutsDir === layoutsDir &&
      cached.fingerprint === fingerprint
    ) {
      return cached.layouts;
    }
    const layouts = await discoverThemeLayouts(themeName, layoutsDir);
    cached = fingerprint !== undefined ? { layoutsDir, fingerprint, layouts } : undefined;
    return layouts;
  };
}
```

The fingerprint filter MUST match `discoverThemeLayouts`'s own filter
(`.astro`, not `_`-prefixed) so an added/removed/renamed layout file always
changes the fingerprint.

### Step 3: Wire the cache through `createDeckupVitePlugins`

In `apps/cli/src/deckup-vite-plugins.ts`:

1. `createDeckupVitePlugins` creates ONE cache instance per call:
   `const discoverCached = createThemeLayoutDiscoveryCache();`
2. Pass it down to the three factories
   (`createVirtualThemeLayoutsPlugin`, `createVirtualDeckPlugin`,
   `createAstroDeckValidationPlugin`), and from there into
   `refreshThemeLayouts(theme, discoverCached)` /
   `refreshThemeRuntime(theme, options, discoverCached)`.
3. Inside `refreshThemeLayouts`, replace the direct
   `discoverThemeLayouts(theme.name, theme.layoutsDir)` call with
   `discoverCached(theme.name, theme.layoutsDir)`. Everything else —
   including the catch block — stays byte-identical.

### Step 4: Skip rewriting an unchanged generated Page

In `deckup-vite-plugins.ts`, give `writeFreshGeneratedPage` a small
last-written memo so repeated loads don't rewrite an identical file inside
Astro's `srcDir` (needless writes can trigger extra watcher churn). Keep the
memo alongside the cache created in `createDeckupVitePlugins`:

```ts
// in createDeckupVitePlugins:
const generatedPageMemo = { lastSource: undefined as string | undefined };
```

In `writeFreshGeneratedPage`, compute
`const source = createGeneratedPageComponentSource(theme.slotNames ?? [], VIRTUAL_DECKUP_THEME_LAYOUTS_ID);`
and return early (before `mkdir`/`writeFile`) when
`source === generatedPageMemo.lastSource`; otherwise write and update the
memo. Note the memo is per-`createDeckupVitePlugins` call, so the first load
after server start always writes (correct: `astro.ts` also writes it during
config creation, but the plugin cannot assume that).

**Verify**: `vp check` → exit 0. `vp run @deckup/cli#test` → exit 0.

### Step 5: Add direct tests

Create `apps/cli/tests/theme-layouts.test.ts` (model temp-dir helpers after
`withProjectRoot` in `apps/cli/tests/astro.test.ts:17-25`):

1. `discoverThemeLayouts` on a temp dir with `cover.astro` (containing
   `<slot />`) and `two-column.astro` (containing `<slot name="left" />` and
   `<slot name="right" />`) returns 2 layouts sorted by filename, with
   `slotNames` `[]`-vs-`["left","right"]` and `importPath` starting with
   `/@fs/`.
2. Files starting with `_` and non-`.astro` files are ignored.
3. Empty dir throws `/must include at least one layouts\/\*\.astro/`.
4. Missing dir throws `/must include a readable layouts directory/`.
5. Cache hit: `createThemeLayoutDiscoveryCache()`, call twice on an
   unchanged dir → second result is the SAME array reference
   (`expect(second).toBe(first)`).
6. Cache invalidation: after overwriting one layout file with new slot
   markup (use `writeFile` then, if the test is flaky on mtime granularity,
   `utimes` to bump mtime explicitly), the next call returns updated
   `slotNames` and a different reference.
7. Cache invalidation on file addition: adding a new `.astro` file changes
   the result set.

**Verify**: `vp run @deckup/cli#test` → exit 0, including the 7 new tests.

### Step 6: Manual HMR smoke test

Run `vp run example#dev`, open the printed URL, then edit
`packages/theme-google-basic/layouts/cover.astro` (e.g. change a visible
style/text) and save. The browser must reflect the change without a manual
restart. Revert the edit afterwards (`git checkout -- packages/theme-google-basic`).

**Verify**: `vp run ready` → exit 0, and
`git status --porcelain packages/` → empty.

## Test plan

- New file `apps/cli/tests/theme-layouts.test.ts` with the 7 cases in
  Step 5 (this also closes part of audit finding TEST-05: theme discovery
  had no direct tests).
- Regression: all existing `astro.test.ts` theme/layout fixtures pass
  unchanged; Plan 001 characterization tests pass unchanged.
- Manual: Step 6 HMR smoke test.

## Done criteria

- [ ] `vp run ready` exits 0
- [ ] `apps/cli/tests/theme-layouts.test.ts` exists; 7 new tests pass
- [ ] `refreshThemeLayouts`'s catch block is byte-identical to before (`git diff` shows no change to it)
- [ ] Cache-hit test asserts reference equality (proves parse was skipped)
- [ ] Manual HMR check performed and theme edits still hot-reload
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 004 has not landed (import paths in this plan assume its layout).
- The HMR smoke test fails (theme edit does not reload) — the fingerprint
  cache is serving stale layouts; report, do not band-aid with time-based
  expiry.
- mtime granularity makes test 6 flaky even with explicit `utimes` — report
  the platform behavior instead of loosening the assertion.
- Any existing `astro.test.ts` theme fixture fails.

## Maintenance notes

- The cache is per-`createDeckupVitePlugins` call (per dev server / per
  build), so there is no cross-project or cross-run staleness by design.
- If Deckup ever supports multiple themes at once, the single-slot cache
  (`cached` holds one layoutsDir) must become a Map keyed by layoutsDir.
- Reviewer: scrutinize that the fingerprint's file filter exactly matches
  `discoverThemeLayouts`'s filter, and that the error-fallback contract in
  `refreshThemeLayouts` is untouched.
- Deliberately deferred: fixing the error-substring match itself (audit
  finding #10, not selected), and `prepareRuntime`'s unconditional rm+cp.
