# Plan 001: Add characterization tests for the Astro deck transformation pipeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c7aa912..HEAD -- apps/cli/src/slida-vite-plugins.ts apps/cli/tests/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `c7aa912`, 2026-07-02

## Why this matters

`apps/cli/src/slida-vite-plugins.ts` (592 lines) is the most complex and most
load-bearing module in Slida: it parses `.astro` deck source with
`@astrojs/compiler-rs`, rewrites it by byte-offset edits, and separately
rewrites Astro's _compiled_ JS output by string scanning. None of its exported
functions (`countAstroDeckPages`, `validateAstroDeckSource`,
`transformAstroDeckSource`, `createSlidaVitePlugins`) is imported by any test
file today — coverage exists only indirectly through full `buildDeck()`
integration tests in `apps/cli/tests/astro.test.ts`. Two follow-up plans
(002: replace the compiled-output string scanner with an AST-based transform;
003: rework the UTF-8 byte-offset converter) will refactor this exact file.
Characterization tests must land first so those refactors are verified against
pinned current behavior.

## Current state

Relevant files:

- `apps/cli/src/slida-vite-plugins.ts` — the module under test.
  - `toSourceIndex` (line 154) — converts UTF-8 byte offsets from the Astro
    compiler AST into JS string indices. Only reachable through the public
    transform functions.
  - `analyzeAstroDeckSource` (line 258) — validates deck structure (Page
    import required, only top-level `<Page>` allowed, at least one page) and
    computes source edits.
  - `countAstroDeckPages` (line 277), `validateAstroDeckSource` (line 282),
    `transformAstroDeckSource` (line 286) — exported, untested.
  - `findMatchingBrace` (line 290), `findCompiledPagePropsSpans` (line 316,
    marker string `'$$renderComponent($$result, "Page", Page,'`),
    `addCompiledLayoutProp` (line 333), `transformCompiledAstroDeckSource`
    (line 345) — internal, untested; this is the compiled-output path.
  - `createSlidaVitePlugins` (line 581) — exported factory returning three
    plugins: `slida:virtual-theme-layouts`, `slida:virtual-deck`,
    `slida:astro-deck-validation`.
- `apps/cli/tests/astro.test.ts` — existing integration tests (structure to
  imitate for helpers, NOT to duplicate).
- `apps/cli/tests/mdx-pages.test.ts` — the exemplar for pure-function unit
  tests in this repo. Match its style:

```ts
// apps/cli/tests/mdx-pages.test.ts:1-10
import { expect, test } from "vite-plus/test";

import {
  analyzeMdxDeckSource,
  countMdxDeckPages,
  ...
} from "../src/slida-mdx-pages.ts";
```

Key excerpts of the code under test as it exists today:

```ts
// apps/cli/src/slida-vite-plugins.ts:277-288
export function countAstroDeckPages(source: string, filePath = "<deck>") {
  const ast = parseAstroDeck(source, filePath);
  return (ast.body ?? []).filter(isTopLevelPage).length;
}

export function validateAstroDeckSource(source: string, filePath = "<deck>") {
  return analyzeAstroDeckSource(source, filePath).pageCount;
}

export function transformAstroDeckSource(source: string, filePath = "<deck>") {
  return applySourceEdits(source, analyzeAstroDeckSource(source, filePath).edits);
}
```

```ts
// apps/cli/src/slida-vite-plugins.ts:345-360
function transformCompiledAstroDeckSource(
  source: string,
  layouts: AstroPageLayout[],
  filePath: string,
) {
  const propSpans = findCompiledPagePropsSpans(source);
  if (propSpans.length !== layouts.length) {
    throw new Error(
      `Failed to transform Astro deck ${filePath}: compiled Page count ${propSpans.length} does not match analyzed page count ${layouts.length}.`,
    );
  }
  const edits = propSpans.map((span, index) =>
    addCompiledLayoutProp(source, span, layouts[index].layout),
  );
  return applySourceEdits(source, edits).replace(/<layout(?:\s+[^<>]*)?><\/layout>/g, "");
}
```

Behavioral facts to characterize (verified against the current code):

- A valid Astro deck source must import `Page` as the default import from
  `"@slida/cli/page"` in frontmatter, and its body may contain only
  whitespace and top-level `<Page>` elements (see `analyzeAstroDeckSource`,
  line 258-275).
- `transformAstroDeckSource` inserts ` layout="<id>"` into each `<Page>`
  opening tag and removes `<layout id="..." />` child declarations.
- Layout defaults come from `apps/cli/src/layout.ts`: page index 0 →
  `"cover"`, all others → `"default"` (`getDefaultSlidaLayout`, line 5-7).
- Multiple `<layout>` children in one page, a missing/non-string `id`
  attribute, or a non-self-closing `<layout>` each throw (lines 205-234).
- The compiled path (`transformCompiledAstroDeckSource`) injects
  `"layout": "<id>"` as the first key of each compiled Page props object and
  strips rendered `<layout ...></layout>` HTML remnants.

Repo conventions:

- Tests use `import { expect, test } from "vite-plus/test";` (never raw
  vitest).
- Lint rule `vite-plus/prefer-vite-plus-imports` is enforced — import from
  `vite-plus` / `vite-plus/test`, not `vite` / `vitest`.

## Commands you will need

| Purpose        | Command                  | Expected on success |
| -------------- | ------------------------ | ------------------- |
| Install        | `vp install`             | exit 0              |
| CLI tests      | `vp run @slida/cli#test` | exit 0, all pass    |
| Lint/fmt/types | `vp check`               | exit 0              |
| Full gate      | `vp run ready`           | exit 0              |

## Scope

**In scope** (the only files you should modify/create):

- `apps/cli/tests/slida-vite-plugins.test.ts` (create)
- `apps/cli/src/slida-vite-plugins.ts` — ONE permitted change only: add
  `export` to `transformCompiledAstroDeckSource` (Step 2). No other edits.

**Out of scope** (do NOT touch):

- `apps/cli/src/index.ts` — do not add the new export to the public package
  surface; tests import from `../src/slida-vite-plugins.ts` directly.
- Any behavioral change to `slida-vite-plugins.ts`. If a test reveals what
  looks like a bug, characterize the CURRENT behavior and note it in your
  report — do not fix it here.
- `apps/cli/tests/astro.test.ts` and all other existing tests.

## Git workflow

- Branch: `advisor/001-vite-plugin-characterization-tests`
- Commit style: short imperative subject, matching `git log` (e.g. "Add
  draggable navigation menu"). Suggested: `Add characterization tests for deck transforms`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the test file with source-transform characterization tests

Create `apps/cli/tests/slida-vite-plugins.test.ts`. Import:

```ts
import { expect, test } from "vite-plus/test";

import {
  countAstroDeckPages,
  transformAstroDeckSource,
  validateAstroDeckSource,
} from "../src/slida-vite-plugins.ts";
```

Define a reusable valid deck fixture as a template string:

```ts
const twoPageDeck = `---
import Page from "@slida/cli/page";
---

<Page title="Intro">
  <h1>Intro</h1>
</Page>
<Page title="Details">
  <layout id="two-column" />
  <p>Body</p>
</Page>
`;
```

Write these tests (exact behaviors, all against current code):

1. `countAstroDeckPages` returns `2` for `twoPageDeck`.
2. `validateAstroDeckSource` returns `2` for `twoPageDeck`.
3. `transformAstroDeckSource` on `twoPageDeck`:
   - result contains `<Page title="Intro" layout="cover">`
   - result contains `<Page title="Details" layout="two-column">`
   - result does not contain `<layout` (declaration removed).
4. Default layouts: a deck with two pages and no `<layout>` declarations gets
   `layout="cover"` on page 1 and `layout="default"` on page 2.
5. Self-closing Page: `<Page title="Solo" />` (single page, self-closing) —
   transform inserts the attribute before the `/>`:
   result contains `<Page title="Solo" layout="cover" />`.
6. Error: source without the `Page` import throws `/must import Page/`.
7. Error: top-level non-Page element (e.g. a `<div>` next to Pages) throws
   `/top-level content must be <Page> components only/`.
8. Error: zero pages throws `/at least one top-level <Page>/`.
9. Error: two `<layout>` declarations in one page throws
   `/multiple layout declarations/`.
10. Error: `<layout id={expr} />` (non-string id) throws
    `/string id attribute/`.
11. Error: non-self-closing `<layout id="x"></layout>` throws
    `/must be self-closing/`.
12. **UTF-8 characterization** (protects Plan 003): a deck whose frontmatter
    or first page contains multi-byte characters BEFORE later pages, e.g.:

```ts
const emojiDeck = `---
import Page from "@slida/cli/page";
---

<Page title="日本語🎉">
  <h1>絵文字 🚀 と CJK</h1>
</Page>
<Page>
  <layout id="two-column" />
  <p>after multibyte</p>
</Page>
`;
```

    Assert the transform still produces `layout="cover"` on page 1,
    `layout="two-column"` on page 2, removes the `<layout>` declaration, and
    leaves the multi-byte text intact (`expect(result).toContain("絵文字 🚀 と CJK")`).

**Verify**: `vp run @slida/cli#test` → exit 0, all tests pass including the
new file.

### Step 2: Export `transformCompiledAstroDeckSource` for tests

In `apps/cli/src/slida-vite-plugins.ts` line 345, change:

```ts
function transformCompiledAstroDeckSource(
```

to:

```ts
// Exported for tests only; not part of the public package surface (index.ts).
export function transformCompiledAstroDeckSource(
```

Do NOT add it to `apps/cli/src/index.ts`.

**Verify**: `vp check` → exit 0.

### Step 3: Add compiled-output characterization tests

Append to the same test file, importing `transformCompiledAstroDeckSource`.
Hand-craft compiled-output fixtures that match what the Astro compiler emits
(the code only keys off the marker + a following object literal):

```ts
const compiledTwoPages = [
  'const html = $$render`${$$renderComponent($$result, "Page", Page, { "title": "Intro" }, { "default": () => $$render`<h1>Intro</h1>` })}',
  '${$$renderComponent($$result, "Page", Page, {}, { "default": () => $$render`<layout id="two-column"></layout><p>Body</p>` })}`;',
].join("\n");
```

Tests:

1. Layout props are injected as the first key of each props object:
   result contains `{ "layout": "cover", "title": "Intro" }` (note: current
   implementation emits exactly `{ "layout": <json>,<original body>}` for
   non-empty objects — assert with `toContain('"layout": "cover"')` and
   `toContain('"layout": "two-column"')` rather than exact whitespace if the
   exact string is brittle; run once, observe the exact output, then pin it).
2. Empty props object `{}` becomes `{ "layout": "two-column" }` (current code
   emits `{ "layout": "two-column" }` — pin observed output).
3. Rendered `<layout id="two-column"></layout>` remnants are removed from the
   output (`expect(result).not.toContain("<layout")`).
4. Braces inside string values do not break span detection:
   a props object like `{ "title": "curly { not a brace }" }` still gets the
   layout key injected and the remainder unchanged.
5. Count mismatch throws: calling with `layouts` array length 1 against
   `compiledTwoPages` throws `/compiled Page count 2 does not match analyzed page count 1/`.

Call signature: `transformCompiledAstroDeckSource(source, [{ layout: "cover" }, { layout: "two-column" }], "<deck>")`.

**Verify**: `vp run @slida/cli#test` → exit 0; the new test count includes
all tests from Steps 1 and 3.

## Test plan

This plan IS the test plan. New file: `apps/cli/tests/slida-vite-plugins.test.ts`
covering the ~17 cases above. Model structure after
`apps/cli/tests/mdx-pages.test.ts`.

## Done criteria

- [ ] `vp run @slida/cli#test` exits 0; `apps/cli/tests/slida-vite-plugins.test.ts` exists with ≥15 passing tests
- [ ] `vp check` exits 0
- [ ] `vp run ready` exits 0
- [ ] `git diff --stat` shows only the two in-scope files changed
- [ ] The only source change in `slida-vite-plugins.ts` is the `export` keyword + comment on `transformCompiledAstroDeckSource`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift).
- The UTF-8 test (Step 1, case 12) FAILS — that means the multi-byte offset
  conversion is actually broken today; that is a bug report, not something to
  fix in this plan.
- The compiled-output fixture in Step 3 cannot be made to pass because
  `findCompiledPagePropsSpans` behaves differently than described — capture
  the actual behavior and report before pinning wrong expectations.
- Any existing test starts failing.

## Maintenance notes

- Plans 002 and 003 refactor the internals these tests pin. When those plans
  land, the tests must keep passing UNCHANGED (except that 002 may legally
  change the exact injected-props whitespace — if so, 002 must update the
  pinned strings and say so in its report).
- Reviewer: check that assertions pin behavior (exact strings/regexes), not
  implementation details like private function call order.
