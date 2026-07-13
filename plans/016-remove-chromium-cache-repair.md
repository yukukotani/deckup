# Plan 016: Remove Chromium cache error-string repair

> **Executor instructions**: Let `@puppeteer/browsers` installation errors
> propagate unchanged. Keep the post-install executable existence check.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- apps/cli/src/browser.ts apps/cli/tests/browser.test.ts apps/web/src/content/docs/references/cli.md .agents/skills/use-deckup/references/cli.md`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

The browser resolver recognizes one English Puppeteer error by three string
fragments, uninstalls the cached browser, and retries once. This is brittle
against dependency updates and performs destructive recovery for a rare local
cache state. A failed installation should remain visible; manual recovery can
be documented without a production retry abstraction.

## Current state

- `apps/cli/src/browser.ts:1-9`: imports `uninstall`.
- `:23-28`: operations seam used only by repair tests.
- `:53-75`: string detector and uninstall/reinstall helper.
- `:98-106`: resolver calls repair helper, then verifies executable exists.
- `apps/cli/tests/browser.test.ts`: two tests dedicated to the helper.

## Commands you will need

| Purpose | Command                                                            | Expected |
| ------- | ------------------------------------------------------------------ | -------- |
| CLI     | `vp run deckup#check && vp run deckup#test && vp run deckup#build` | pass     |
| Docs    | `vp run @deckup/web#check && vp run @deckup/web#build`             | pass     |
| Full    | `vp run ready`                                                     | pass     |

## Scope

**In scope**:

- `apps/cli/src/browser.ts`
- `apps/cli/tests/browser.test.ts` (delete)
- `apps/web/src/content/docs/references/cli.md`
- `.agents/skills/use-deckup/references/cli.md`

**Out of scope**: browser versions, cache locations, environment variable
names, automatic retries for network failures, or deleting the postcondition.

## Git workflow

- Branch: `advisor/016-remove-chromium-cache-repair`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Remove the repair path

Delete `uninstall`, `ChromiumInstallOperations`,
`isMissingCachedExecutableError`, and `installChromiumWithCacheRepair`.
Replace its call with direct `await install(...)`. Keep the second
`pathExists(executablePath)` check and Deckup error.

Delete `apps/cli/tests/browser.test.ts`; do not retain an abstraction solely
to test JavaScript promise propagation.

### Step 2: Document safe manual recovery

Add a short browser troubleshooting section to the CLI reference and sync the
agent reference. Explain that users should stop Deckup and remove only the
configured Deckup browser cache—or point `DECKUP_BROWSER_CACHE_DIR` at a new
empty directory. Do not publish broad recursive-delete commands.

### Step 3: Verify

Run CLI, docs, and full commands. Then:

```bash
rg -n 'installChromiumWithCacheRepair|isMissingCachedExecutableError|uninstall' apps/cli/src/browser.ts apps/cli/tests
git diff --exit-code -- pnpm-lock.yaml pnpm-workspace.yaml apps/cli/package.json
```

Expected: no symbol matches and no dependency files changed.

## Test plan

No replacement unit test: direct `install()` rejection propagation is native
async behavior. Existing PDF/PNG lifecycle tests and full builds remain the
normal-path regression net.

## Done criteria

- [ ] Error-string parsing, uninstall, retry, seam, and dedicated tests are gone.
- [ ] Post-install executable validation remains.
- [ ] Safe manual recovery is documented in both references.
- [ ] No dependency/lockfile change occurred.
- [ ] `vp run ready` passes; only in-scope files changed.

## STOP conditions

- The helper gains a non-test caller before execution.
- Puppeteer install API changed from the locked behavior.
- Removing the post-install check becomes necessary; that is separate scope.

## Maintenance notes

If Puppeteer later exposes a structured corruption API, recovery can be
reconsidered from measured user demand. Do not match vendor prose again.
