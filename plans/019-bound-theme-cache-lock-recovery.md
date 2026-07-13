# Plan 019: Bound npm theme cache locking and surface recovery failures

> **Executor instructions**: Keep per-cache-key atomic locking. Do not replace
> it with uncoordinated concurrent writes. Remove stale-lock auto-deletion and
> silent cleanup/collision recovery in favor of finite waits and explicit
> errors.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/npm-theme.ts apps/cli/tests/config.test.ts apps/web/src/content/docs/references/theme.mdx`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plans/017-pin-pacote-manifest-contract.md, plans/018-stop-repairing-invalid-theme-cache.md
- **Category**: tech-debt
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

The cache lock waits forever, deletes locks older than ten minutes, ignores
release failures, and treats rename collisions as successful if another entry
validates. Those paths attempt to recover from process crashes and out-of-band
writes but can also delete an active long-running lock or hide filesystem
faults. Atomic per-key serialization remains valuable; its failure policy
should be finite and explicit.

## Current state

- `packages/core/src/npm-theme.ts:422-455`: 50ms infinite poll and 10-minute
  mtime-based lock deletion.
- `:457-470`: temp cleanup and lock release swallow every error.
- `:473-491`: `EEXIST`/`ENOTEMPTY` promotion adopts another entry.
- `:520-546`: extraction errors invoke silent cleanup.

Use the existing `AggregateError` lifecycle pattern in
`apps/cli/src/astro.ts:716-725`, not a new custom error container.

## Commands you will need

| Purpose | Command                                            | Expected |
| ------- | -------------------------------------------------- | -------- |
| Focused | `vp run deckup#test -- tests/config.test.ts`       | pass     |
| Checks  | `vp run @deckup/core#check && vp run deckup#check` | pass     |
| Full    | `vp run ready`                                     | pass     |

## Scope

**In scope**:

- `packages/core/src/npm-theme.ts`
- `apps/cli/tests/config.test.ts`
- `apps/web/src/content/docs/references/theme.mdx`

**Out of scope**: lock-free writes, cross-host/network-filesystem guarantees,
PID/heartbeat leases, cache format, Pacote retries, and a cache-clean command.

## Git workflow

- Branch: `advisor/019-bound-theme-cache-locks`
- Conventional commits per lock and cleanup changes; no push unless instructed.

## Steps

### Step 1: Characterize safe same-key concurrency

After Plan 018, retain the uncached `Promise.all` test and assert one manifest
request, identical returned package roots, and an empty locks directory. This
test must pass throughout the refactor.

### Step 2: Replace stale recovery with a finite waiter timeout

Keep atomic `mkdir(lockDir)`. Replace `cacheLockStaleMs` and `stat`/mtime-based
deletion with a 60-second acquisition deadline measured by a monotonic source
(`performance.now()` or an equivalent private injected clock), never wall-clock
`Date.now()`. On timeout, throw a private
`NpmThemeCacheLockTimeoutError` naming the theme spec, duration, and lock path,
with guidance to remove the lock only after confirming no Deckup process uses
it. The holder continues; only the waiter fails.

Add a fake monotonic-clock test with an old pre-created lock. Prove it times
out, does not delete the lock, performs no confirmation/network operation, and
is unaffected by simulated wall-clock rollback. Do not sleep for 60 real
seconds.

**STOP** if real npm-theme downloads routinely exceed 60 seconds in supported
CI; choose a measured bound before proceeding.

### Step 3: Surface temp and release failures

Delete catch-and-ignore helpers. If a primary operation and cleanup/release
both fail, throw `AggregateError([primary, cleanup], message)`. If only cleanup
or release fails after successful work, propagate that failure. Add tests for
both temp cleanup and lock release failures, modeled after the PNG lifecycle
AggregateError test. Include a separate case where protected work succeeds but
lock release fails; it must reject instead of returning the successful result.

Use a private source-local lifecycle operations seam for filesystem fault
injection. Do not add lock, `rm`, clock, or sleep operations to the publicly
exported `NpmThemeInstallOperations` type or to `packages/core/src/index.ts`.

### Step 4: Remove promotion collision adoption

Let `rename(tempEntryDir, cacheEntryDir)` fail on `EEXIST`/`ENOTEMPTY`; normal
same-key writers are serialized by the lock. Replace the success-on-collision
test with one that expects failure, verifies the out-of-band entry is not
overwritten, and verifies temp cleanup behavior.

### Step 5: Document timeout recovery and verify

Update theme docs with finite-wait and abandoned-lock guidance. Run focused,
check, and full commands.

## Test plan

- Same-key uncached calls still perform one download.
- Old lock is not automatically removed and reaches timeout under fake time.
- Wall-clock rollback cannot extend the monotonic timeout.
- Primary+temp cleanup failure yields ordered `AggregateError.errors`.
- Primary+release failure yields ordered aggregate error.
- Successful work plus release failure propagates the release error.
- Promotion collision fails and preserves the external entry.

## Done criteria

- [ ] Plans 017 and 018 are DONE before implementation begins.
- [ ] Lock acquisition has a finite bound and no mtime deletion.
- [ ] The deadline uses a monotonic source, covered against wall-clock rollback.
- [ ] No cleanup/release catch silently ignores errors.
- [ ] Primary failure plus temp-cleanup failure produces an `AggregateError`
      ordered as `[primary, cleanup]`.
- [ ] Primary failure plus lock-release failure produces an `AggregateError`
      ordered as `[primary, release]`.
- [ ] A success-plus-release-failure test proves no result escapes.
- [ ] Fault-injection seams remain private and do not expand public npm types.
- [ ] Rename collision is not adopted as success.
- [ ] Same-key concurrency remains serialized.
- [ ] Focused tests and `vp run ready` pass.
- [ ] Only in-scope files changed; index updated.

## STOP conditions

- Cache is shared across hosts/network filesystems.
- Automatic crash recovery is mandatory; that requires a lease design.
- A 60-second bound is unsupported by measured download duration.
- Error-shape compatibility forbids `AggregateError`.

## Maintenance notes

The lock directory remains a protocol boundary. Reviewer should verify the
timeout affects only waiters and that no path can write a final cache entry
without owning the per-key lock.
