# Plan 008: Prove the compiled Astro fallback is unreachable, then remove it

> **Executor instructions**: This is a conditional plan. Run the reachability
> experiment before deleting production code. If the fallback is reached by
> any supported real path, revert only the temporary probe, mark this plan
> BLOCKED in `plans/README.md`, record the command that reached it, and stop.
> Do not make the test fixture pass by weakening the probe.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- packages/core/src/deckup-vite-plugins.ts packages/core/src/index.ts packages/core/tests/deckup-vite-plugins.test.ts apps/cli/src/index.ts apps/cli/src/deckup-vite-plugins.ts apps/cli/tests/deckup-vite-plugins.test.ts`
> If the compiled transform symbols or production transform hook changed,
> stop and reassess the experiment before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

The registry validation plugin supports both raw Astro source and already
compiled Astro JavaScript. The compiled branch adds an Acorn AST walker,
source-span editing, Page/PageMeta reconciliation, test-only exports, and
roughly 180 lines of tests. A direct fixture proves that implementation works,
but does not prove Astro or Vite reaches it in normal dev/build pipelines.
Removal is justified only after real CLI and registry paths demonstrate that
the source `load`/`transform` path always runs first.

## Current state

Production entry (`packages/core/src/deckup-vite-plugins.ts:1273-1308`):

```ts
if (source.includes("<Page")) {
  // transform raw Astro source
}
if (!source.includes("$$renderComponent")) return undefined;
const compiledAst = this.parse(source);
if (compiledPagesAlreadyHaveLayoutProps(source, compiledAst)) return undefined;
// analyze original source, then transform compiled output
return transformCompiledAstroDeckAst(source, compiledAst, layouts, ...);
```

Compiled-only implementation occupies `:60-73` and `:688-872`.
`transformCompiledAstroDeckSource` is re-exported only to support tests from:

- `packages/core/src/index.ts:49-61`
- `apps/cli/src/index.ts:20-36`
- `apps/cli/src/deckup-vite-plugins.ts`

Despite its source comment calling it test-only, the symbol is externally
importable through both package entrypoints. Deleting it is therefore an
intentional breaking API removal as well as an internal cleanup; record it in
the execution/release notes and STOP if the repository has acquired a policy
that forbids that break in the next release.

The direct registry fixture at
`packages/core/tests/deckup-vite-plugins.test.ts:865-915` invokes the hook with
compiled text manually. It is a probe control, not production reachability
evidence.

## Commands you will need

| Purpose             | Command                      | Expected on success |
| ------------------- | ---------------------------- | ------------------- |
| Core tests          | `vp run @deckup/core#test`   | all pass            |
| CLI tests           | `vp run deckup#test`         | all pass            |
| Astro integration   | `vp run @deckup/astro#test`  | all pass            |
| CLI build path      | `vp run example#build:astro` | exit 0              |
| Registry build path | `vp run @deckup/web#build`   | exit 0              |
| Full gate           | `vp run ready`               | exit 0              |

## Scope

**In scope**:

- `packages/core/src/deckup-vite-plugins.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/deckup-vite-plugins.test.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/deckup-vite-plugins.ts`
- `apps/cli/tests/deckup-vite-plugins.test.ts`

**Out of scope**:

- `packages/core/src/deckup-mdx-pages.ts`; Acorn remains required there.
- Astro/Vite dependency changes or plugin-order changes.
- Replacing this fallback with another compiled-output parser.
- Generated `.deckup/`, `dist/`, or `.astro/` files.

## Git workflow

- Branch: `advisor/008-remove-compiled-fallback`
- Use conventional commits; do not push unless instructed.
- The temporary probe must not remain in the final diff.

## Steps

### Step 1: Install a precise temporary reachability probe

Immediately after `compiledPagesAlreadyHaveLayoutProps(...)` returns false and
immediately before reading `originalSource`, add:

```ts
if (process.env.DECKUP_PROBE_COMPILED_ASTRO_FALLBACK === "1") {
  throw new Error("DECKUP_COMPILED_ASTRO_FALLBACK_REACHED");
}
```

Do not place it at the start of `transform`: compiled source that already has
layout props is expected and is not the fallback under investigation.

**Verify control**:

```bash
DECKUP_PROBE_COMPILED_ASTRO_FALLBACK=1 vp run @deckup/core#test -- tests/deckup-vite-plugins.test.ts -t "registry compiled fallback uses the injected Vite parser"
```

Expected: the selected artificial fixture fails with the exact sentinel. If
it does not, the probe is invalid: STOP.

### Step 2: Exercise every supported real path

Run all of the following with the probe enabled:

```bash
vp run deckup#build
DECKUP_PROBE_COMPILED_ASTRO_FALLBACK=1 vp run example#build:astro
DECKUP_PROBE_COMPILED_ASTRO_FALLBACK=1 vp run @deckup/astro#test
DECKUP_PROBE_COMPILED_ASTRO_FALLBACK=1 vp run @deckup/web#build
```

Then run dev servers and make real HTTP requests, not just startup checks:

```bash
DECKUP_PROBE_COMPILED_ASTRO_FALLBACK=1 vp run example#dev:astro -- --port 49321
curl -fsS http://127.0.0.1:49321/ | rg 'data-deckup-slide'
```

```bash
DECKUP_PROBE_COMPILED_ASTRO_FALLBACK=1 vp run @deckup/web#dev -- --host 127.0.0.1 --port 49322
curl -fsS http://127.0.0.1:49322/slides/intro/ | rg 'data-deckup-slide'
curl -fsS http://127.0.0.1:49322/slides/default/ | rg 'data-deckup-slide'
```

Stop both servers cleanly. Expected: every build/request succeeds and no
server emits the sentinel.

### Step 3: Apply the decision gate

- **REACHED**: revert the probe, make no other source/test edits, mark this
  plan BLOCKED, and record the exact command, route, and mode.
- **INCONCLUSIVE**: if any path fails for another reason, revert the probe and
  STOP. Do not treat an unexecuted path as unreachable.
- **UNREACHED**: only if the control fired and all listed real path checks did
  not, continue to Step 4.

Before continuing, append a dated Plan 008 execution entry to the reconciliation
log in `plans/README.md`. Record the control result and the result of every CLI
build/dev, Astro integration test, and registry build/dev command. This is the
durable evidence for the deletion; terminal scrollback alone is insufficient.

### Step 4: Remove the compiled-output implementation

From `packages/core/src/deckup-vite-plugins.ts`, remove:

- `Parser` import (but not the `acorn` dependency).
- `AstroPageLayout.hasPageMeta`, `CompiledAstroNode`, `CompiledPageRecord`.
- `hasPageMeta` population in `analyzeAstroLayouts`.
- helpers from `isCompiledAstroNode` through
  `transformCompiledAstroDeckSource` (`:688-872`).
- the compiled branch in the registry validation plugin (`:1292-1308`).

Remove `transformCompiledAstroDeckSource` from the three re-export files.
Delete only compiled fixtures/tests listed in Current state; retain raw-source,
PageMeta, registry, code-highlighting, and multibyte tests.

**Verify**:

```bash
rg -n 'transformCompiledAstroDeckSource|CompiledAstroNode|CompiledPageRecord|compiledPagesAlreadyHaveLayoutProps' packages apps
```

Expected: no matches.

### Step 5: Run regression and production gates

```bash
vp run @deckup/core#test
vp run deckup#test
vp run @deckup/astro#test
vp run example#build:astro
vp run @deckup/web#build
vp run ready
```

Expected: all exit 0 and rendered decks retain `data-deckup-layout`.

## Test plan

No new permanent probe seam is allowed. Existing real integration/build tests
become the regression contract. Remove compiled-only fixtures and direct tests;
leave all raw Astro and registry tests unchanged.

## Done criteria

- [ ] The control fixture reached the temporary sentinel.
- [ ] CLI build/dev and registry build/dev completed without the sentinel.
- [ ] `@deckup/astro#test` completed with the probe without the sentinel.
- [ ] `plans/README.md` records the control and every real-path command/result.
- [ ] The temporary probe is absent from the final diff.
- [ ] All compiled-only helpers, exports, fixtures, and tests are gone.
- [ ] The intentional externally-importable named-export removal is recorded
      for the next release.
- [ ] Acorn remains because MDX still imports it.
- [ ] `vp run ready` passes.
- [ ] Only in-scope files changed and the index row is updated.

## STOP conditions

- Any supported real path reaches the sentinel.
- A required real path cannot be exercised conclusively.
- Removal requires changing plugin order or Astro configuration.
- A raw-source, registry, or real-build test loses layout metadata.

## Maintenance notes

Future Astro upgrades should be tested through real builds, not by restoring a
compiled-output parser preemptively. Reviewer must verify that the reachability
evidence was recorded before accepting the deletion.
