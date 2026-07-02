# Plan 007: Derive the CLI version from package.json instead of a hardcoded constant

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c7aa912..HEAD -- apps/cli/src/commands.ts apps/cli/tests/commands.test.ts apps/cli/package.json`
> If `commands.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `c7aa912`, 2026-07-02

## Why this matters

`apps/cli/src/commands.ts` hardcodes `export const VERSION = "0.0.0"` and
passes it to the gunshi CLI as the version reported by `slida --version`.
`apps/cli/package.json` independently declares `"version": "0.0.0"`. The two
values coincide today only because no release has happened; the first version
bump in package.json will silently make `slida --version` lie. Reading the
version from package.json at runtime removes the skew permanently.

## Current state

Relevant files:

- `apps/cli/src/commands.ts` — the constant and its use:

```ts
// apps/cli/src/commands.ts:6
export const VERSION = "0.0.0";
```

```ts
// apps/cli/src/commands.ts:131-140
export async function runSlida(argv = process.argv.slice(2)) {
  return await cli(argv, entryCommand, {
    name: "slida",
    version: VERSION,
    subCommands: {
      dev: devCommand,
      build: buildCommand,
    },
  });
}
```

- `apps/cli/package.json` — `"version": "0.0.0"` (line 3) and
  `"exports"` includes `"./package.json": "./package.json"`.
- Build layout: `vp pack` bundles `src/cli.ts` and `src/index.ts` into
  `dist/*.mjs` (see `apps/cli/vite.config.ts` `pack.entry`). At runtime the
  compiled module lives at `dist/commands…` inside the package, so
  `package.json` is resolvable via `createRequire(import.meta.url).resolve("@slida/cli/package.json")`
  — BUT self-referencing requires the package name to resolve, which works in
  the workspace and for installed consumers. A more robust approach that
  works in both source (`src/`) and bundled (`dist/`) forms is walking up
  from `import.meta.url`, since `package.json` sits one directory above both
  `src/` and `dist/`.
- Precedent for `createRequire` + `import.meta.url` in this repo:
  `apps/cli/src/theme.ts:18` (`const cliRequire = createRequire(import.meta.url);`)
  and `apps/cli/src/astro.ts:33-34`. Match that style.
- `VERSION` is exported from `commands.ts` but is NOT re-exported by
  `apps/cli/src/index.ts` (verified: `index.ts` exports `normalizeBuildValues`,
  `normalizeDevValues`, `normalizeLogLevel`, `runSlida` from `./commands.ts`).
  Renaming/removing `VERSION` breaks no public API.
- Tests: `apps/cli/tests/commands.test.ts` does not reference `VERSION`.

## Commands you will need

| Purpose        | Command                   | Expected on success |
| -------------- | ------------------------- | ------------------- |
| Install        | `vp install`              | exit 0              |
| CLI tests      | `vp run @slida/cli#test`  | exit 0, all pass    |
| Lint/fmt/types | `vp check`                | exit 0              |
| CLI build      | `vp run @slida/cli#build` | exit 0              |
| Full gate      | `vp run ready`            | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `apps/cli/src/commands.ts`
- `apps/cli/tests/commands.test.ts` (extend)

**Out of scope** (do NOT touch):

- `apps/cli/package.json` — no version bump, no new fields.
- `apps/cli/vite.config.ts` — no build-time injection plugin; the runtime
  read is simpler and survives tool changes.
- `apps/cli/src/index.ts` — public surface unchanged.

## Git workflow

- Branch: `advisor/007-derive-cli-version-from-package-json`
- Commit style: short imperative subject. Suggested: `Derive CLI version from package.json`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the constant with a package.json read

In `apps/cli/src/commands.ts`, replace line 6
(`export const VERSION = "0.0.0";`) with:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readCliVersion() {
  // package.json sits one directory above both src/ (dev) and dist/ (packed).
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  try {
    const packageJson = JSON.parse(readFileSync(fileURLToPath(packageJsonUrl), "utf8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readCliVersion();
```

Keep the export name `VERSION` (used by `runSlida` below; nothing else
imports it). Place the imports at the top of the file with the existing
import block. Note: a static `import pkg from "../package.json" with { type: "json" }`
is NOT used because `vp pack` would inline the version at build time,
reintroducing skew for any workflow that edits `package.json` after packing;
the `readFileSync` at module load is trivial cost for a CLI.

**Verify**: `vp check` → exit 0.

### Step 2: Prove it works from source and from the packed bundle

**Verify** (both):

1. From source (test runner path) — Step 3's unit test covers this.
2. From the packed bundle:
   `vp run @slida/cli#build && node apps/cli/dist/cli.mjs --version`
   → prints `0.0.0` (the current package.json version), exit 0.

### Step 3: Add a regression test

Append to `apps/cli/tests/commands.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/commands.ts";

test("VERSION matches the package.json version", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { version: string };
  expect(VERSION).toBe(packageJson.version);
});
```

(Merge the imports into the file's existing import block; the file already
imports from `../src/commands.ts`.)

**Verify**: `vp run @slida/cli#test` → exit 0, including the new test.

### Step 4: Full verification

**Verify**: `vp run ready` → exit 0, and
`rg -n '"0\.0\.0"' apps/cli/src/commands.ts` → matches only the two
fallback literals inside `readCliVersion` (no standalone hardcoded constant).

## Test plan

- One new test in `apps/cli/tests/commands.test.ts` asserting
  `VERSION === package.json version` (survives any future version bump by
  construction).
- Manual: `node apps/cli/dist/cli.mjs --version` after `vp run @slida/cli#build`.

## Done criteria

- [ ] `vp run ready` exits 0
- [ ] `node apps/cli/dist/cli.mjs --version` prints the package.json version
- [ ] New `VERSION matches the package.json version` test passes
- [ ] `export const VERSION = "0.0.0";` no longer exists as a bare constant
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- After `vp run @slida/cli#build`, `node apps/cli/dist/cli.mjs --version`
  prints `0.0.0` from the FALLBACK path rather than the real read — i.e. if
  you change package.json's version to a test value, rebuild, and the output
  does not follow it. That means the packed bundle's `import.meta.url` does
  not sit one level below package.json; report the actual dist layout.
  (Remember to revert any test edit to package.json.)
- The bundler statically rewrites `new URL("../package.json", import.meta.url)`
  in a way that breaks the runtime read.
- Gunshi's `cli()` options shape changed (drift) so `version:` is no longer
  where the excerpt shows.

## Maintenance notes

- When release automation is added (version bumps in package.json), no code
  change is needed — `slida --version` follows automatically, and the Step 3
  test enforces it.
- Reviewer: check the fallback `"0.0.0"` only masks a missing/unreadable
  package.json (broken install), not normal operation.
