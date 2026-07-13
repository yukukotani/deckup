# Plan 009: Remove the legacy `<layout>`-specific diagnostic

> **Executor instructions**: Remove only the special recognition and error for
> the former lowercase marker. Do not reintroduce `<layout>` as supported
> syntax, and do not weaken any `PageMeta` validation.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/page-meta.ts packages/core/src/deckup-vite-plugins.ts packages/core/src/deckup-mdx-pages.ts packages/core/tests apps/cli/tests`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/008-prove-remove-compiled-astro-fallback.md
- **Category**: migration
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

Deckup no longer supports `<layout id="..." />`, yet both Astro and MDX
parsers recursively search for it solely to emit a migration-specific error.
This preserves knowledge of a short-lived pre-`PageMeta` syntax in production
and six test surfaces. After this change, lowercase `<layout>` receives normal
Astro/MDX treatment and never selects a Deckup layout.

## Current state

- `packages/core/src/page-meta.ts:1-2` defines both current and legacy names.
- `packages/core/src/deckup-vite-plugins.ts:191-207,476-481` recognizes legacy
  Astro nodes and throws `Legacy <layout> declaration...`.
- `packages/core/src/deckup-mdx-pages.ts:109-141,176-181` mirrors that logic.
- Legacy rejection tests exist in both core suites and the CLI compatibility
  suites, including `apps/cli/tests/astro.test.ts:688-690,751-753`.

`PageMeta` validation immediately following these branches—duplicate,
placement, children, self-closing, static layout, and layout-id checks—is the
current contract and must remain.

## Commands you will need

| Purpose      | Command                                                                                               | Expected |
| ------------ | ----------------------------------------------------------------------------------------------------- | -------- |
| Core focused | `vp run @deckup/core#test -- tests/deckup-vite-plugins.test.ts tests/mdx-pages.test.ts`               | pass     |
| CLI focused  | `vp run deckup#test -- tests/deckup-vite-plugins.test.ts tests/mdx-pages.test.ts tests/astro.test.ts` | pass     |
| Full gate    | `vp run ready`                                                                                        | pass     |

## Scope

**In scope**: the three core source files above and their corresponding tests
under `packages/core/tests/` and `apps/cli/tests/`.

**Out of scope**: accepting `<layout>` as metadata, changing default layout
selection, changing `PageMeta`, or updating unrelated docs.

## Git workflow

- Branch: `advisor/009-remove-legacy-layout-diagnostic`
- Conventional commit; do not push unless instructed.

## Steps

### Step 1: Remove legacy-only production symbols

Delete `LEGACY_LAYOUT_MARKER_NAME`, its imports,
`isLegacyLayoutDeclaration`, `isLegacyLayoutNode`, and both dedicated throw
blocks. Rename marker collectors to PageMeta-specific names and have them
collect only `PageMeta`; retain recursive collection so nested/misplaced
PageMeta is still rejected.

**Verify**:

```bash
rg -n 'Legacy <layout>|LEGACY_LAYOUT_MARKER_NAME|isLegacyLayout' packages apps
```

Expected after test updates: no matches.

### Step 2: Replace legacy rejection tests with ordinary-content tests

First extract the legacy tuple from `invalidAstroPageMetaBuildCases` into a
standalone test; do not treat it as a PageMeta-invalid case after this change.
For core Astro and MDX tests, replace the top-level and nested legacy cases
with positive characterization:

- no Deckup-specific legacy error is thrown;
- the page receives its normal default layout;
- lowercase `layout` remains ordinary content where the framework preserves it;
- it is never interpreted as an explicit Deckup layout.

For CLI build tests, remove the Deckup-specific error expectation. If Astro or
MDX itself rejects or rewrites the lowercase element, assert only framework
behavior—not the deleted Deckup diagnostic.

Do not edit any invalid `PageMeta` test.

**Verify**: run both focused commands above.

### Step 3: Run the full gate

**Verify**: `vp run ready` → exit 0.

## Test plan

Use the existing table-driven invalid-case tests as the structural pattern.
The new positive tests prove removal without preserving old syntax as a layout
API. Existing PageMeta cases provide the regression net.

## Done criteria

- [ ] No legacy marker symbol or diagnostic remains.
- [ ] Astro and MDX ordinary-content behavior is characterized.
- [ ] Replacement tests assert only absence of Deckup legacy interpretation
      and do not pin exact Astro/MDX-owned rendered markup.
- [ ] Every existing PageMeta validation still passes.
- [ ] Plan 008 is DONE, or it is BLOCKED with the probe reverted and its
      reachability evidence recorded in `plans/README.md`.
- [ ] `vp run ready` passes.
- [ ] Only in-scope files changed; index updated.

## STOP conditions

- The change starts treating `<layout>` as Deckup metadata.
- A PageMeta validation must be removed or weakened.
- Plan 008 is still IN PROGRESS on the same file.

## Maintenance notes

The public migration becomes a hard break without a tailored message. Reviewer
should verify tests do not accidentally promise rendering details owned by a
specific Astro/MDX version.
