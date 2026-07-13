# Plan 011: Propagate invalid Astro code-block source spans

> **Executor instructions**: Preserve optional handling when AST spans are
> absent. Only stop swallowing errors when numeric spans are present but
> invalid or not UTF-8 boundaries.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/deckup-vite-plugins.ts packages/core/tests/deckup-vite-plugins.test.ts apps/cli/tests/deckup-vite-plugins.test.ts apps/cli/tests/astro.test.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/010-fail-on-missing-theme-layouts.md
- **Category**: correctness
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

Static code highlighting currently turns source-offset conversion failures
into “not highlightable” and builds successfully with raw code. That hides
Astro compiler/source disagreement. Missing optional metadata may remain a
no-op, but malformed numeric offsets should fail where the mismatch occurs.

## Current state

`getOptionalSpan()` at
`packages/core/src/deckup-vite-plugins.ts:377-390` returns `undefined` both
when spans are absent and when `createSourceIndexConverter` throws. Its only
consumer at `:417-419` silently skips highlighting.

The required-span helper at `:363-375` and converter tests at
`packages/core/tests/deckup-vite-plugins.test.ts:498-541` establish the
fail-fast error vocabulary.

## Commands you will need

| Purpose | Command                                                                       | Expected |
| ------- | ----------------------------------------------------------------------------- | -------- |
| Core    | `vp run @deckup/core#test -- tests/deckup-vite-plugins.test.ts`               | pass     |
| CLI     | `vp run deckup#test -- tests/deckup-vite-plugins.test.ts tests/astro.test.ts` | pass     |
| Full    | `vp run ready`                                                                | pass     |

## Scope

**In scope**:

- `packages/core/src/deckup-vite-plugins.ts`
- `packages/core/tests/deckup-vite-plugins.test.ts`

**Out of scope**: supported/dynamic code-block rules, Shiki behavior, compiler
upgrades, or changing absent spans into errors.

## Git workflow

- Branch: `advisor/011-propagate-astro-span-errors`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Expose a source-local test seam

Export `getOptionalSpan` with a comment that it is test-only and is not
re-exported by `packages/core/src/index.ts`. Do not add it to public package
exports.

Add direct tests:

1. source `"é"`, span `{ start: 1, end: 2 }` throws
   `/is not a UTF-8 boundary/`;
2. node `{}` still returns `undefined`.

**Verify before implementation**: case 1 returns `undefined` and fails.

### Step 2: Remove only the catch

Keep the missing-number guard, then return converted start/end directly.
Let converter errors retain their existing message and context.

**Verify**: core focused tests pass.

### Step 3: Run real highlighting regressions

**Verify**: CLI focused and full commands pass.

## Test plan

Two direct tests distinguish missing from malformed spans. Existing static,
dynamic, entity, multibyte, and real-build highlighting tests remain intact.

## Done criteria

- [ ] Numeric conversion errors are no longer caught.
- [ ] Missing spans remain optional.
- [ ] The test seam is not publicly re-exported.
- [ ] All focused tests and `vp run ready` pass.
- [ ] Only in-scope files changed; index updated.

## STOP conditions

- Normal compiler output now throws in existing highlighting tests.
- Testing requires a public export.
- The source is transformed before span conversion in a way that invalidates
  otherwise valid compiler offsets; report rather than restoring the catch.

## Maintenance notes

Future compiler changes should surface as explicit failures. Reviewer should
ensure unsupported author syntax still follows existing raw-code behavior and
is not conflated with invalid compiler offsets.
