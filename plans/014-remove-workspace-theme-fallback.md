# Plan 014: Resolve built-in themes only through package exports

> **Executor instructions**: Delete the workspace-relative path fallback. A
> failed built-in dependency resolution must use the same contextual error as
> any other package-resolution failure.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/theme.ts packages/core/tests/theme.test.ts packages/core/package.json packages/theme-*/package.json`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

When resolving a built-in theme package fails, Core constructs a path two
directories above its own module and assumes the repository's `packages/theme-*`
layout. That works only in this monorepo and masks missing dependencies or bad
exports in published installations. Healthy workspace resolution already
succeeds through declared package dependencies.

## Current state

`packages/core/src/theme.ts:59-93` first calls
`resolver.resolve("<theme>/package.json")`; its catch at `:72-87` synthesizes
`coreModuleDir/../../theme-*/package.json` for built-ins. The four theme
packages are dependencies in `packages/core/package.json:33-41`, and each
exports `./package.json`.

## Commands you will need

| Purpose         | Command                                           | Expected |
| --------------- | ------------------------------------------------- | -------- |
| Core            | `vp run @deckup/core#test -- tests/theme.test.ts` | pass     |
| CLI integration | `vp run deckup#test -- tests/config.test.ts`      | pass     |
| Full            | `vp run ready`                                    | pass     |

## Scope

**In scope**:

- `packages/core/src/theme.ts`
- `packages/core/tests/theme.test.ts` (new)

**Out of scope**: dependency versions, theme export maps, npm-theme cache,
third-party package resolution, and source-export conditions.

## Git workflow

- Branch: `advisor/014-remove-workspace-theme-fallback`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Add package-contract tests

Create `packages/core/tests/theme.test.ts`. Assert every value in
`BUILTIN_DECKUP_THEME_PACKAGES` exists in Core dependencies and resolves via
its `./package.json` export. Add a source-local injected resolver seam so a
forced built-in resolution failure proves the contextual error is thrown and
its cause retained rather than a workspace path returned.

### Step 2: Delete the fallback

Remove `coreModuleDir`, its `fileURLToPath` import, and the built-in branch in
the catch. Keep the existing `Unable to resolve Deckup theme...` error for all
package types.

**Verify**: core and CLI focused tests pass.

### Step 3: Full verification

**Verify**: `vp run ready` → exit 0.

## Test plan

New tests cover mapping/dependency/export consistency and forced failure.
Existing config tests cover normal default and named built-in themes.

## Done criteria

- [ ] No workspace package path is synthesized in `theme.ts`.
- [ ] All built-ins resolve through package exports.
- [ ] A named package-contract test proves every built-in mapping is declared
      in Core dependencies and resolves through `./package.json`.
- [ ] Forced failure preserves the resolver cause.
- [ ] `vp run ready` passes; only in-scope files changed.

## STOP conditions

- Any built-in cannot resolve in healthy source or packed mode.
- Mapping and dependency manifest are inconsistent.
- A published theme lacks its documented `./package.json` export.

## Maintenance notes

Adding a built-in theme now requires both the mapping and Core dependency to
remain synchronized; the new test is the enforcement point.
