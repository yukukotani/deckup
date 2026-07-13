# Plan 013: Fail fast when required Core runtime assets cannot resolve

> **Executor instructions**: Treat all three Core runtime assets as required.
> Do not add filesystem guesses or duplicate runtime files as replacements.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- apps/cli/src/integration.ts apps/cli/tests/config.test.ts apps/cli/tests/dev-source-exports.test.ts packages/core/package.json`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

The CLI catches resolution failures for Core package metadata, CSS, and
navigation, then lets Vite virtual-module loading return `undefined`. There is
no fallback renderer, so the recovery path only delays and obscures a broken
installation. Package exports already define these assets as mandatory.

## Current state

`apps/cli/src/integration.ts:33-47` converts every `require.resolve` failure to
`undefined`. At `:51-72`, missing CSS/navigation causes virtual module `load`
to return `undefined`. `packages/core/package.json:9-22` includes `runtime` and
exports all required subpaths; `apps/cli/tests/dev-source-exports.test.ts`
checks this packaging contract.

## Commands you will need

| Purpose     | Command                                                                       | Expected |
| ----------- | ----------------------------------------------------------------------------- | -------- |
| Focused     | `vp run deckup#test -- tests/config.test.ts tests/dev-source-exports.test.ts` | pass     |
| Check/build | `vp run deckup#check && vp run deckup#build`                                  | exit 0   |
| Full        | `vp run ready`                                                                | pass     |

## Scope

**In scope**:

- `apps/cli/src/integration.ts`
- `apps/cli/tests/config.test.ts`

**Out of scope**: core export maps, runtime content, Vite aliases outside this
integration, and workspace-relative fallbacks.

## Git workflow

- Branch: `advisor/013-fail-fast-core-runtime-assets`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Add a deterministic resolver seam and failure tests

Model hook tests after `apps/cli/tests/config.test.ts:904-938`. Introduce a
source-local resolver function/parameter that defaults to `require.resolve`
and is not re-exported by `apps/cli/src/index.ts`. Test that a failed required
specifier throws immediately, names that specifier, and preserves `cause`.
Also assert healthy setup includes the Core runtime directory in `fs.allow`.

### Step 2: Make required values non-nullable

Replace both catch-and-undefined helpers with one fail-fast resolver. Resolve
package metadata, CSS, and navigation when constructing the integration or
plugin, make `cssModuleId` a string, and remove missing-asset branches from
`load()` and `fs.allow` assembly.

**Verify**: focused tests pass.

### Step 3: Verify source and packed modes

Run check/build and `vp run ready`. Existing source-export packaging tests must
pass unchanged.

## Test plan

- Healthy package: assets resolve and Core runtime directory is allowed.
- Broken package: immediate contextual error with original cause.
- Existing source and packed CLI behavior remains covered.

## Done criteria

- [ ] Runtime resolver functions return `string`, never `undefined`.
- [ ] Virtual module loads have no missing-required-asset fallback.
- [ ] Failure and healthy-path tests pass.
- [ ] `vp run ready` passes; only in-scope files changed.

## STOP conditions

- Healthy source or packed builds cannot resolve a declared Core subpath.
- Fix requires changing `packages/core/package.json`.
- A duplicated runtime implementation appears necessary.

## Maintenance notes

Packaging failures should remain early and explicit. Reviewer should reject
any new fallback path that guesses a monorepo or installation layout.
