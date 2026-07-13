# Plan 017: Use one Pacote 22 manifest contract

> **Executor instructions**: Target the repository's supported Pacote 22
> registry-manifest shape. Do not retain fallback fields under new helper names.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/npm-theme.ts packages/core/src/npm-registry.d.ts packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml apps/cli/tests/config.test.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

Deckup accepts `integrity`, `_integrity`, or `dist.integrity`, and the same
three-way family for the resolved tarball. Pacote 22 normalizes registry
manifests to `_resolved` and `_integrity`; supporting additional shapes expands
the public test seam and hides incomplete custom manifests. One dependency
contract is easier to type, test, and upgrade deliberately.

## Current state

`packages/core/src/npm-theme.ts:57-68` declares all compatibility fields.
Helpers at `:211-217` select among them, while `:533-539` also falls back to
`name@version`. `packages/core/src/npm-registry.d.ts:17-28` duplicates the
broad shape. The type is re-exported from `packages/core/src/index.ts:88-95`.

The installed Pacote 22 registry implementation maps `dist.tarball` to
`_resolved` and integrity data to `_integrity`. This plan intentionally makes
custom `NpmThemeInstallOperations` follow that same shape.

## Commands you will need

| Purpose         | Command                                            | Expected |
| --------------- | -------------------------------------------------- | -------- |
| Focused         | `vp run deckup#test -- tests/config.test.ts`       | pass     |
| Core/CLI checks | `vp run @deckup/core#check && vp run deckup#check` | pass     |
| Full            | `vp run ready`                                     | pass     |

## Scope

**In scope**:

- `packages/core/src/npm-theme.ts`
- `packages/core/src/npm-registry.d.ts`
- `apps/cli/tests/config.test.ts`

**Out of scope**: Pacote upgrades, accepting file/git/remote specs, cache
metadata format, lock behavior, or removing the public operations types.

## Git workflow

- Branch: `advisor/017-pin-pacote-manifest-contract`
- Conventional commit; no push unless instructed.

## Steps

### Step 1: Update the test fixture to the target contract

Change `fakeNpmThemeOperations` in
`apps/cli/tests/config.test.ts:189-207` to return `_resolved` and
`_integrity`. Update hand-written manifests around `:741-762`. Add one direct
test proving those fields are passed unchanged to `extract`.

### Step 2: Narrow source and ambient types

Define `NpmThemePackageManifest` and Pacote `Manifest` as:

```ts
{ name: string; version: string; _resolved: string; _integrity?: string }
```

Delete `manifestIntegrity`, `manifestResolved`, the `dist`/top-level fields,
and the `name@version` fallback. Call `extract(manifest._resolved, ...)` and
conditionally pass only `manifest._integrity`.

This is an intentional type-level breaking change for custom operations; do
not add deprecated aliases.

### Step 3: Verify

Run focused, check, and full commands. Confirm:

```bash
rg -n 'manifestIntegrity|manifestResolved|dist\?\.|manifest\.resolved|manifest\.integrity' packages/core/src apps/cli/tests/config.test.ts
```

Expected: no compatibility-path matches.

## Test plan

- Fixture uses only Pacote 22 normalized fields.
- Direct assertion verifies resolved tarball and integrity forwarding.
- Existing approved download/cache tests cover normal behavior.

## Done criteria

- [ ] Manifest has one resolved field and one optional integrity field.
- [ ] Package-spec fallback is gone.
- [ ] Source and ambient declarations agree.
- [ ] `plans/README.md` records the breaking custom
      `NpmThemeInstallOperations` manifest-type change for the next release.
- [ ] Focused tests and `vp run ready` pass.
- [ ] No dependency/lockfile versions changed; index updated.

## STOP conditions

- The locked Pacote major is no longer 22.
- A real Pacote 22 registry manifest lacks `_resolved`.
- The project explicitly requires multiple Pacote majors or non-registry specs.

## Maintenance notes

Pacote major upgrades must now include a manifest-contract test update. Do not
preemptively restore multiple response shapes without supporting two versions
at runtime.
