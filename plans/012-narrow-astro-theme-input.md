# Plan 012: Limit `@deckup/astro` theme input to string selectors

> **Executor instructions**: Remove the pre-resolved object path without
> changing the public core resolver or deck-level theme precedence.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/astro/src/index.ts packages/astro/tests/`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

`DeckupAstroOptions.theme` is typed `unknown` so the integration can accept an
internal `DeckupResolvedTheme` object. The original integration plan says this
was needed only until a shared resolver existed; `@deckup/core` now provides
that resolver. Keeping the branch exposes an undocumented internal shape and
bypasses normal package/layout validation.

## Current state

- `packages/astro/src/index.ts:26-34`: `theme?: unknown`.
- `:95-103`: structural `isCoreCompatibleTheme` check.
- `:113-115`: object values bypass `resolveDeckupThemeLayouts`.
- `:343`: integration setup uses the compatibility wrapper.

README and Web docs show only built-in, installed-package, or `npm:` string
selectors. Deck frontmatter precedence in `resolveEffectiveThemes` is current
product behavior and remains unchanged.

## Commands you will need

| Purpose | Command                      | Expected |
| ------- | ---------------------------- | -------- |
| Tests   | `vp run @deckup/astro#test`  | pass     |
| Check   | `vp run @deckup/astro#check` | exit 0   |
| Build   | `vp run @deckup/astro#build` | exit 0   |
| Full    | `vp run ready`               | pass     |

## Scope

**In scope**:

- `packages/astro/src/index.ts`
- `packages/astro/tests/options-types.test.ts` (new)
- `packages/astro/tests/integration.test.ts`

**Out of scope**: `DeckupResolvedTheme`, core resolver exports, CLI config,
deck frontmatter, npm-theme behavior, or theme docs already describing strings.

## Git workflow

- Branch: `advisor/012-narrow-astro-theme-input`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Lock the public type boundary

Add `packages/astro/tests/options-types.test.ts`, modeled after
`apps/cli/tests/config-types.test.ts`. Confirm `theme: "minimal"` type-checks
and an object value has `@ts-expect-error`.

**Verify before implementation**: the object expectation is unused/fails
because current type is `unknown`.

### Step 2: Remove the compatibility input

Change `DeckupAstroOptions.theme` to `string`, delete
`isCoreCompatibleTheme`, delete `resolveFallbackTheme`, and call
`resolveDeckupThemeLayouts(projectRoot, options.theme)` directly. Keep
`hasThemeLayouts`/`uniqueThemes` where used for resolved outputs.

Add one runtime integration test that bypasses TypeScript with `as never` and
asserts an object input fails with `/Deckup theme must be a string/`. This
prevents JavaScript callers from silently regaining structural compatibility.

**Verify**: tests and check pass.

### Step 3: Verify declarations and builds

Run build and confirm generated declarations type `theme?: string`, then run
`vp run ready`.

## Test plan

- Compile-time: string accepted, object rejected.
- Runtime: untyped object rejected by the shared resolver.
- Existing multi-deck and deck-theme override integration tests unchanged.

## Done criteria

- [ ] `theme?: unknown` and `isCoreCompatibleTheme` are absent.
- [ ] String and runtime rejection tests pass.
- [ ] Generated declaration exposes `theme?: string`.
- [ ] `plans/README.md` records the public `DeckupAstroOptions.theme` breaking
      type change for the next release.
- [ ] `vp run ready` passes; only in-scope files changed.

## STOP conditions

- A repository consumer passes a resolved object.
- Removal requires changing core resolver/type APIs.
- Deck-level theme precedence changes.

## Maintenance notes

This is a breaking change only for undocumented object callers. Future theme
inputs should extend the documented selector type deliberately rather than by
structural acceptance of internal resolved data.
