# Plan 018: Report invalid npm theme caches without replacing them

> **Executor instructions**: Preserve validation and temporary-download
> cleanup. Remove only the cache-hit validation catch that deletes a committed
> cache entry and starts a new download.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/npm-theme.ts apps/cli/tests/config.test.ts apps/web/src/content/docs/references/theme.mdx`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/017-pin-pacote-manifest-contract.md
- **Category**: tech-debt
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

When cached metadata or package validation fails, Deckup deletes the cache
entry, asks for download approval, and replaces it. This erases the original
state and turns a local validation error into a network workflow. Completed
cache entries are atomically promoted, so corruption or manual edits should be
reported and repaired explicitly by the user.

## Current state

```ts
// packages/core/src/npm-theme.ts:501-508
if (await pathExists(cacheEntryDir)) {
  try {
    await assertDirectory(...);
    return await validateCachedNpmThemeEntry(...);
  } catch (error) {
    if (!(error instanceof NpmThemeCacheValidationError)) throw error;
    await rm(cacheEntryDir, { force: true, recursive: true });
  }
}
```

Validators at `:232-367` already provide detailed metadata/package errors.
Layout discovery errors are not wrapped in this class and already fail.

## Commands you will need

| Purpose | Command                                            | Expected |
| ------- | -------------------------------------------------- | -------- |
| Focused | `vp run deckup#test -- tests/config.test.ts`       | pass     |
| Checks  | `vp run @deckup/core#check && vp run deckup#check` | pass     |
| Docs    | `vp run @deckup/web#check`                         | pass     |
| Full    | `vp run ready`                                     | pass     |

## Scope

**In scope**:

- `packages/core/src/npm-theme.ts`
- `apps/cli/tests/config.test.ts`
- `apps/web/src/content/docs/references/theme.mdx`

**Out of scope**: cache format migration, a cache-clean command, initial
download approval, temp cleanup, lock policy, or changing validation messages.

## Git workflow

- Branch: `advisor/018-stop-repairing-theme-cache`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Rewrite repair tests as fail-fast tests

Update `apps/cli/tests/config.test.ts:628-674` to assert invalid metadata and
metadata/package version mismatch:

- reject with the existing validation error;
- do not call confirmation, manifest, or extract;
- preserve the original cache files unchanged.

Add one invalid package-json/name test with the same no-network/no-delete
assertions. Change the concurrent test at `:676-709` to start from a genuinely
uncached entry so it continues testing serialization independently.

### Step 2: Remove the repair transition

On cache hit, call `assertDirectory` and
`validateCachedNpmThemeEntry` directly and return. Do not catch
`NpmThemeCacheValidationError`; keep the class because validators use it.

### Step 3: Document explicit recovery

Update the npm-theme cache section to say invalid entries are not
automatically replaced. Tell users to verify no Deckup process is using the
entry before removing only the named cache entry, then rerun interactively.
Avoid broad cache-deletion commands.

### Step 4: Verify

Run focused/check/docs/full commands.

## Test plan

- Invalid Deckup metadata preserved and reported.
- Version mismatch preserved and reported.
- Invalid package metadata preserved and reported.
- Valid cache and uncached download tests unchanged.
- Same-key uncached concurrency still downloads once.

## Done criteria

- [ ] Plan 017 is DONE before implementation begins.
- [ ] Cache-hit validation has no catch/delete/fall-through.
- [ ] Invalid cache tests prove no network operation and no mutation.
- [ ] Recovery documentation matches fail-fast behavior.
- [ ] `vp run ready` passes; only in-scope files changed.

## STOP conditions

- An existing cache-format migration is required.
- Product policy requires automatic cache replacement.
- Recovery requires designing a new CLI command.

## Maintenance notes

Future cache-format changes need an explicit versioned migration, not reuse of
the deleted “anything invalid means delete and redownload” behavior.
