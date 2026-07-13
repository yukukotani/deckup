# Plan 010: Fail when a theme layouts directory disappears

> **Executor instructions**: Remove the stale-theme fallback only. Preserve
> layout discovery caching and normal HMR refresh behavior.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/deckup-vite-plugins.ts packages/core/tests/deckup-vite-plugins.test.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/009-remove-legacy-layout-diagnostic.md
- **Category**: tech-debt
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

`refreshThemeLayouts()` catches one error by message substring and returns the
previous theme metadata when `layouts/` vanishes. This hides a broken theme and
allows generated modules to disagree with the filesystem. The canonical
discovery error is already clear, so the stale fallback should not override it.

## Current state

```ts
// packages/core/src/deckup-vite-plugins.ts:914-929
try {
  const layouts = await discoverCached(theme.name, theme.layoutsDir);
  return { ...theme, layouts, slotNames: ... };
} catch (error) {
  if (error instanceof Error &&
      error.message.includes("must include a readable layouts directory")) {
    return theme;
  }
  throw error;
}
```

`discoverThemeLayouts()` at `packages/core/src/theme-layouts.ts:131-155`
already owns the canonical missing-directory and empty-directory errors.

## Commands you will need

| Purpose | Command                                                                                     | Expected |
| ------- | ------------------------------------------------------------------------------------------- | -------- |
| Focused | `vp run @deckup/core#test -- tests/deckup-vite-plugins.test.ts tests/theme-layouts.test.ts` | pass     |
| Full    | `vp run ready`                                                                              | pass     |

## Scope

**In scope**:

- `packages/core/src/deckup-vite-plugins.ts`
- `packages/core/tests/deckup-vite-plugins.test.ts`

**Out of scope**: fingerprint algorithm, cache invalidation, canonical error
wording, generated Page memoization, or theme package APIs.

## Git workflow

- Branch: `advisor/010-fail-missing-theme-layouts`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Add a stale-cache regression test

Following the virtual theme layout tests around
`packages/core/tests/deckup-vite-plugins.test.ts:625-751`, create a temporary
theme, load it once to warm the cache, delete its entire `layouts/` directory,
then call the same plugin's `load()` again. Expect rejection matching
`/must include a readable layouts directory/`.

Recreate the directory with a different layout ID and slot shape—for example
`layouts/recovered.astro` with a named slot—after that rejection and call
`load()` a third time. It must contain only the new layout/slot metadata, not
the old `cover` metadata. This proves a real re-discovery (rather than an old
fingerprint/cache hit) and that the next valid filesystem state recovers
without adding retries or timers.

**Verify before implementation**: the new test fails because current code
returns the old theme.

### Step 2: Remove the catch

Call `discoverCached` directly and return refreshed metadata. Keep early
returns for no theme and themes without a refreshable `layoutsDir`.

**Verify**: focused command passes.

### Step 3: Full verification

**Verify**: `vp run ready` → exit 0.

## Test plan

One new regression test covers warm cache → directory removal → canonical
error. Existing cache-hit, mutation, and multi-theme tests remain unchanged.

## Done criteria

- [ ] No message-substring catch remains in `refreshThemeLayouts`.
- [ ] The warm-cache deletion test passes.
- [ ] The same test proves delete → canonical error → recreate → successful
      load of different metadata, with no retry/timer introduced in production
      code.
- [ ] Normal cache invalidation tests still pass.
- [ ] `vp run ready` passes and only in-scope files changed.

## STOP conditions

- The new test still succeeds before the catch is removed (wrong path tested).
- Fixing the test requires changing `createThemeLayoutDiscoveryCache`.
- Ordinary layout edits stop refreshing.

## Maintenance notes

An editor's non-atomic directory replacement may now produce a transient HMR
error; the next valid filesystem event should recover normally. Do not add a
timer/retry without a separate measured requirement.
