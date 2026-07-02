# Plan 004: Consolidate duplicated Astro AST utilities and generic helpers into shared modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c7aa912..HEAD -- apps/cli/src/`
> Changes from Plans 002/003 inside `slida-vite-plugins.ts` are EXPECTED.
> For every excerpt below, confirm the named function still exists in the
> named file before moving it; treat missing/renamed functions as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-vite-plugin-characterization-tests.md, plans/002-harden-compiled-output-coupling.md, plans/003-fix-tosourceindex-encoder.md
- **Category**: tech-debt
- **Planned at**: commit `c7aa912`, 2026-07-02

## Why this matters

The Astro AST helper layer is duplicated wholesale between
`slida-vite-plugins.ts` and `theme-layouts.ts`: the type shapes
(`AstroIdentifier`, `AstroAttribute`, `AstroNode`, `AstroRoot`) and the
functions `getIdentifierName`, `isJsxElementNamed`, `getAttributeName`,
`getAttribute`, `findAstroRoot` exist twice, character-for-character or
nearly so. Beyond that, `uniqueStrings` is defined three times (`astro.ts`,
`theme.ts`, `slida-vite-plugins.ts`), `normalizePath` three times
(`slida-vite-plugins.ts`, `theme-layouts.ts`, `slida-mdx-pages.ts` — the MDX
one differs: it splits on `/[\\/]+/` instead of `sep`), and the
ENOENT-swallowing file-existence helper twice (`config.ts` `fileExists`,
`runtime.ts` `pathExists`). Every AST-handling fix currently must be applied
in two places; drift between the copies is a real bug vector. This plan
extracts one canonical copy of each into two new modules with zero behavior
change.

## Current state

Duplication map (verified at commit c7aa912; line numbers may have shifted
slightly after Plans 002/003 — locate by symbol name):

| Symbol                                                           | Copy 1                                                                                                                       | Copy 2                                                                  | Copy 3                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AstroIdentifier`/`AstroAttribute`/`AstroNode`/`AstroRoot` types | `slida-vite-plugins.ts:23-55` (superset: also has `start`/`end`, `AstroImportDeclaration`, `AstroSourceEdit`, `frontmatter`) | `theme-layouts.ts:12-30` (subset)                                       | —                                                                                                             |
| `getIdentifierName`                                              | `slida-vite-plugins.ts:77`                                                                                                   | `theme-layouts.ts:40`                                                   | —                                                                                                             |
| `isJsxElementNamed`                                              | `slida-vite-plugins.ts:85`                                                                                                   | `theme-layouts.ts:44`                                                   | —                                                                                                             |
| `getAttributeName`                                               | `slida-vite-plugins.ts:97`                                                                                                   | `theme-layouts.ts:48`                                                   | —                                                                                                             |
| `getAttribute`                                                   | `slida-vite-plugins.ts:101`                                                                                                  | `theme-layouts.ts:52`                                                   | —                                                                                                             |
| `findAstroRoot`                                                  | `slida-vite-plugins.ts:123`                                                                                                  | `theme-layouts.ts:69`                                                   | —                                                                                                             |
| `uniqueStrings`                                                  | `astro.ts:44`                                                                                                                | `theme.ts:29`                                                           | `slida-vite-plugins.ts:366`                                                                                   |
| `normalizePath`                                                  | `slida-vite-plugins.ts:61` (`path.split(sep).join("/")`)                                                                     | `theme-layouts.ts:32` (identical)                                       | `slida-mdx-pages.ts:48` (`path.split(/[\\/]+/).join("/")` — DIFFERENT, collapses repeats and both separators) |
| ENOENT-tolerant exists                                           | `config.ts:26` `fileExists` (bare `access(filePath)`)                                                                        | `runtime.ts:36` `pathExists` (exported; `access(path, constants.F_OK)`) | inline variant in `deck.ts:60-68` (different: rethrows as "deck file not found" — leave alone)                |

Canonical copies to keep:

```ts
// slida-vite-plugins.ts — findAstroRoot (identical in theme-layouts.ts)
function findAstroRoot(value: unknown): AstroRoot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const node = value as AstroRoot & Record<string, unknown>;
  if (node.type === "AstroRoot") return node;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findAstroRoot(item);
        if (found) return found;
      }
    } else {
      const found = findAstroRoot(child);
      if (found) return found;
    }
  }
  return undefined;
}
```

```ts
// runtime.ts:36-44 — pathExists (keep as canonical exists helper)
export async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
```

Important constraints:

- `pathExists` is exported from the package via `apps/cli/src/index.ts:35-40`
  (`export { pathExists, prepareRuntime, ... } from "./runtime.ts";`). Its
  export location must not break — re-export from `runtime.ts` after moving.
- The MDX `normalizePath` variant is BEHAVIORALLY DIFFERENT (regex split).
  Do NOT unify it — `isSelectedFile` in `slida-mdx-pages.ts` depends on
  collapsing mixed separators from vfile paths. Leave `slida-mdx-pages.ts`
  untouched.
- `theme-layouts.ts` has `visitAstroNodes` and `parseAstroLayout`;
  `slida-vite-plugins.ts` has `parseAstroDeck`. These are NOT duplicates
  (different error messages, different traversal purpose) — leave in place,
  but `parseAstroDeck`/`parseAstroLayout` both call `findAstroRoot`, which
  moves.
- Repo convention: intra-package imports use explicit `.ts` extensions
  (`import ... from "./layout.ts"`), enabled by
  `allowImportingTsExtensions` in the root tsconfig.

## Commands you will need

| Purpose        | Command                  | Expected on success |
| -------------- | ------------------------ | ------------------- |
| Install        | `vp install`             | exit 0              |
| CLI tests      | `vp run @slida/cli#test` | exit 0, all pass    |
| Lint/fmt/types | `vp check`               | exit 0              |
| Full gate      | `vp run ready`           | exit 0              |

## Scope

**In scope** (the only files you should modify/create):

- `apps/cli/src/astro-ast.ts` (create)
- `apps/cli/src/fs-utils.ts` (create)
- `apps/cli/src/slida-vite-plugins.ts` (remove moved code, add imports)
- `apps/cli/src/theme-layouts.ts` (remove moved code, add imports)
- `apps/cli/src/astro.ts` (remove `uniqueStrings`, import it)
- `apps/cli/src/theme.ts` (remove `uniqueStrings`, import it)
- `apps/cli/src/config.ts` (remove `fileExists`, import `pathExists`)
- `apps/cli/src/runtime.ts` (move `pathExists` body out, re-export)

**Out of scope** (do NOT touch):

- `apps/cli/src/slida-mdx-pages.ts` — its `normalizePath` is intentionally
  different (see constraints).
- `apps/cli/src/deck.ts` — its inline ENOENT handling produces a different
  user-facing error; not a duplicate.
- `apps/cli/src/index.ts` — public export surface must remain identical
  (`pathExists` keeps being exported from `"./runtime.ts"`).
- Any behavior change whatsoever. This is a pure move/dedupe.

## Git workflow

- Branch: `advisor/004-consolidate-duplicated-utilities`
- Commit style: short imperative subject. Suggested: `Consolidate duplicated Astro AST and fs helpers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `apps/cli/src/astro-ast.ts`

Move from `slida-vite-plugins.ts` (the superset copies) into the new module,
exporting all of them:

- Types: `AstroIdentifier`, `AstroAttribute`, `AstroNode`, `AstroRoot`
  (keep the superset shape including `start`/`end`/`frontmatter`;
  `theme-layouts.ts` code compiles fine against the superset because all
  fields are optional), and `AstroImportDeclaration`.
- Functions: `getIdentifierName`, `isJsxElementNamed`, `getAttributeName`,
  `getAttribute`, `findAstroRoot`.
- Also export `uniqueStrings` and `normalizePath`
  (the `split(sep).join("/")` version; import `sep` from `node:path`) from
  this module OR create a tiny `apps/cli/src/utils.ts` — choose ONE location
  and be consistent; recommended: put `uniqueStrings` and `normalizePath` in
  `astro-ast.ts` is wrong thematically, so create `apps/cli/src/utils.ts`
  with exactly `uniqueStrings` and `normalizePath`.

Keep `AstroSourceEdit`, `AstroPageLayout`, `applySourceEdits`,
`visitAstroNodes`, `parseAstroDeck`, `parseAstroLayout` where they are.

**Verify**: `vp check` → exit 0 (after Step 3 — run at end of Step 3 if
intermediate state doesn't compile).

### Step 2: Rewire `slida-vite-plugins.ts` and `theme-layouts.ts`

- Delete the moved types/functions from both files.
- Add `import { findAstroRoot, getAttribute, getAttributeName, getIdentifierName, isJsxElementNamed, type AstroAttribute, type AstroIdentifier, type AstroImportDeclaration, type AstroNode, type AstroRoot } from "./astro-ast.ts";`
  (each file imports only what it uses; lint will flag unused imports).
- Add `import { normalizePath, uniqueStrings } from "./utils.ts";` where
  used (`slida-vite-plugins.ts` uses both; `theme-layouts.ts` uses
  `normalizePath`).
- `theme-layouts.ts` note: its local `AstroNode` lacked `start`/`end` — the
  superset type is compatible; its `visitAstroNodes` signature
  (`visit: (node: AstroNode) => void`) now uses the imported type.

### Step 3: Rewire `astro.ts` and `theme.ts`

- Delete `function uniqueStrings` from `astro.ts` (line 44) and `theme.ts`
  (line 29); add `import { uniqueStrings } from "./utils.ts";` to each.

**Verify**: `vp check` → exit 0. `vp run @slida/cli#test` → exit 0.

### Step 4: Create `apps/cli/src/fs-utils.ts` and dedupe exists-helpers

- Create `fs-utils.ts` exporting `pathExists` with the exact body currently
  in `runtime.ts:36-44` (including the `constants.F_OK` argument).
- In `runtime.ts`: remove the local definition, add
  `export { pathExists } from "./fs-utils.ts";` (preserves the public
  package export path through `index.ts` unchanged) and import it for the
  internal use in `prepareRuntime`.
- In `config.ts`: delete local `fileExists` (line 26-38), import
  `{ pathExists }` from `./fs-utils.ts`, and replace the two call sites
  (`findSlidaConfigFiles`, line ~48) with `pathExists(filePath)`.
  Behavior note: `fileExists` called `access(filePath)` (default F_OK mode);
  `pathExists` calls `access(path, constants.F_OK)` — identical semantics.

**Verify**: `vp check` → exit 0. `vp run @slida/cli#test` → exit 0
(config.test.ts and astro.test.ts cover both call paths).

### Step 5: Prove the dedupe is complete

**Verify** (each command):

- `rg -n "function uniqueStrings" apps/cli/src/` → exactly 1 match (utils.ts)
- `rg -n "function findAstroRoot" apps/cli/src/` → exactly 1 match (astro-ast.ts)
- `rg -n "function normalizePath" apps/cli/src/` → exactly 2 matches
  (utils.ts + the intentionally-different one in slida-mdx-pages.ts)
- `rg -n "function fileExists|async function pathExists" apps/cli/src/` →
  exactly 1 match (fs-utils.ts)
- `vp run ready` → exit 0

## Test plan

No new tests required — this is a pure move. The regression net is:
Plan 001's characterization tests (AST helpers), `config.test.ts`
(fileExists path), `astro.test.ts` (pathExists / prepareRuntime path), and
`vp check`'s type-aware lint. All must pass unchanged.

## Done criteria

- [ ] `vp run ready` exits 0
- [ ] All five `rg` checks in Step 5 return the stated counts
- [ ] `apps/cli/src/index.ts` is unmodified (`git diff --name-only` does not list it)
- [ ] No test file was modified
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plans 001-003 have not all landed (check `plans/README.md` status).
- A "duplicate" turns out not to be identical when you diff the two copies
  (beyond the documented differences) — report the divergence; it may be a
  latent bug that needs its own decision.
- TypeScript reports errors from the type unification in `theme-layouts.ts`
  that require changing any function's logic (not just imports/annotations).
- Any existing test fails.

## Maintenance notes

- Future AST-handling fixes now have a single home (`astro-ast.ts`). If
  Plan 002's long-term note (stop transforming compiled output) is ever
  executed, `astro-ast.ts` is where shared parsing helpers should continue
  to accumulate.
- Reviewer: verify no `export` was added to or removed from the public
  surface (`apps/cli/src/index.ts` untouched; `pathExists` still resolves).
- Deliberately deferred: unifying `parseAstroDeck`/`parseAstroLayout`
  (different error contexts), the Page markup duplication between
  `runtime/components/Page.astro` and `createGeneratedPageComponentSource`
  (audit finding TECH-DEBT-08 — needs a design decision on canonical source),
  and the full god-module split of `slida-vite-plugins.ts` (audit finding
  TECH-DEBT-03 — L effort, deferred by the maintainer).
