# Plan 015: Fail when CLI package version metadata is invalid

> **Executor instructions**: Preserve deriving the version from the adjacent
> package manifest. Remove only the fabricated `0.0.0` result.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- apps/cli/src/commands.ts apps/cli/tests/commands.test.ts apps/cli/package.json`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

Plan 007 correctly made `deckup --version` read `package.json`, but retained
`0.0.0` for missing, malformed, or untyped metadata. A broken package should
not claim a valid-looking version. Source and packed layouts both require the
adjacent manifest, so failure should be explicit.

## Current state

```ts
// apps/cli/src/commands.ts:30-40
try {
  const packageJson = JSON.parse(readFileSync(...));
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
} catch {
  return "0.0.0";
}
```

`apps/cli/tests/commands.test.ts:75-80` checks only the healthy version.

## Commands you will need

| Purpose        | Command                                        | Expected        |
| -------------- | ---------------------------------------------- | --------------- |
| Focused        | `vp run deckup#test -- tests/commands.test.ts` | pass            |
| Build          | `vp run deckup#build`                          | pass            |
| Packed version | `node apps/cli/dist/cli.mjs --version`         | package version |
| Full           | `vp run ready`                                 | pass            |

## Scope

**In scope**:

- `apps/cli/src/commands.ts`
- `apps/cli/tests/commands.test.ts`

**Out of scope**: version bumping, release automation, Gunshi rendering, and
package layout changes.

## Git workflow

- Branch: `advisor/015-fail-invalid-cli-version`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Add failure-path tests without editing the real manifest

Give `readCliVersion` a package-json URL/reader test seam, export it only from
`commands.ts`, and do not re-export it from package `index.ts`. Using temporary
files, test missing file, malformed JSON, and missing/non-string `version`.
Each must throw a contextual error and never return `0.0.0`.

### Step 2: Replace fallback values with errors

Preserve the normal adjacent URL. Re-throw read/parse failures with `cause`;
throw a clear type error when `version` is absent or not a string. Keep
`export const VERSION = readCliVersion()` and Gunshi wiring unchanged.

**Verify**: focused tests pass.

### Step 3: Verify packed behavior

Build, compare packed `--version` to `apps/cli/package.json`, then run
`vp run ready`.

## Test plan

- Existing healthy equality test.
- Missing file, malformed JSON, and invalid version tests.
- Packed process output after build.

## Done criteria

- [ ] No `0.0.0` fallback remains in `readCliVersion`.
- [ ] Failure tests preserve useful context/cause.
- [ ] Packed CLI prints the manifest version.
- [ ] `vp run ready` passes; only in-scope files changed.

## STOP conditions

- Packed `import.meta.url` is not one directory below the manifest.
- Tests require modifying the real package manifest.
- Bundling inlines or relocates metadata unexpectedly.

## Maintenance notes

Release automation continues to update only package metadata. Reviewers should
treat a startup failure here as a packaging defect, not restore a fake version.
