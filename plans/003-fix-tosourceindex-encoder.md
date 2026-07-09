# Plan 003: Make `toSourceIndex` byte-offset conversion single-pass and encoder-reusing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c7aa912..HEAD -- apps/cli/src/deckup-vite-plugins.ts apps/cli/tests/deckup-vite-plugins.test.ts`
> Changes from Plans 001/002 in these files are EXPECTED. Compare the
> "Current state" excerpt of `toSourceIndex` against the live code before
> proceeding; if `toSourceIndex` itself has changed, treat it as a STOP
> condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-vite-plugin-characterization-tests.md
- **Category**: perf
- **Planned at**: commit `c7aa912`, 2026-07-02

## Why this matters

`toSourceIndex` converts UTF-8 byte offsets (reported by the Astro compiler
AST) into JS string indices. The current implementation rescans the source
from index 0 for EVERY offset lookup and allocates a `new TextEncoder()` for
EVERY character. Each Astro deck transform calls it multiple times per page
(span start, span end, insertion offset), so the work is O(pages × length)
with heavy allocation churn — it runs on every dev-server transform and HMR
of the deck file. The logic is also entirely untested for multi-byte input
until Plan 001 lands. This plan replaces the per-call scan with one shared
`TextEncoder` and a per-transform byte→index map computed in a single pass,
and adds direct unit tests for the conversion.

## Current state

Relevant file: `apps/cli/src/deckup-vite-plugins.ts`.

The function as it exists today:

```ts
// apps/cli/src/deckup-vite-plugins.ts:154-182
function toSourceIndex(source: string, byteOffset: number, context: string) {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new Error(`Failed to transform Astro deck: invalid source offset for ${context}.`);
  }

  let bytes = 0;
  for (let index = 0; index < source.length; ) {
    if (bytes === byteOffset) {
      return index;
    }

    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const character = String.fromCodePoint(codePoint);
    bytes += new TextEncoder().encode(character).length;
    index += character.length;
  }

  if (bytes === byteOffset) {
    return source.length;
  }

  throw new Error(
    `Failed to transform Astro deck: source offset ${byteOffset} is not a UTF-8 boundary for ${context}.`,
  );
}
```

Its three call sites (all within the same file):

- `getRequiredSpan` (line 184-192) — called once per layout node (start+end).
- `getPageAttributeInsertionOffset` (line 194-201) — called once per page.

All call sites receive `source` (the full deck source) plus a byte offset and
a `context` string used in error messages. Error message wording
(`invalid source offset for ...`, `is not a UTF-8 boundary for ...`) is part
of observable behavior — keep it identical.

Plan 001 added `apps/cli/tests/deckup-vite-plugins.test.ts` with an emoji/CJK
deck characterization test that exercises this function end-to-end. That test
must pass before and after this change.

Repo conventions: tests import from `vite-plus/test`; lint enforces
`vite-plus/prefer-vite-plus-imports`.

## Commands you will need

| Purpose        | Command                   | Expected on success |
| -------------- | ------------------------- | ------------------- |
| Install        | `vp install`              | exit 0              |
| CLI tests      | `vp run @deckup/cli#test` | exit 0, all pass    |
| Lint/fmt/types | `vp check`                | exit 0              |
| Full gate      | `vp run ready`            | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `apps/cli/src/deckup-vite-plugins.ts`
- `apps/cli/tests/deckup-vite-plugins.test.ts` (extend; export one function
  for tests as described in Step 1)

**Out of scope** (do NOT touch):

- `apps/cli/src/index.ts` — the test-only export stays off the public
  package surface.
- Changing WHERE offsets come from (the AST byte offsets) or any transform
  semantics. This is a pure internal-representation change.
- `theme-layouts.ts` — it does not use byte offsets.

## Git workflow

- Branch: `advisor/003-fix-tosourceindex-encoder`
- Commit style: short imperative subject. Suggested: `Speed up UTF-8 offset conversion in deck transform`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the per-lookup scan with a single-pass converter

In `apps/cli/src/deckup-vite-plugins.ts`, replace `toSourceIndex` with a
factory that scans the source once and answers all lookups for that source:

```ts
const utf8Encoder = new TextEncoder();

// Exported for tests only; not part of the public package surface (index.ts).
export function createSourceIndexConverter(source: string) {
  // byteToIndex[b] = JS string index for UTF-8 byte offset b (boundaries only).
  const byteToIndex = new Map<number, number>();
  let bytes = 0;
  for (let index = 0; index < source.length; ) {
    byteToIndex.set(bytes, index);
    const codePoint = source.codePointAt(index) as number;
    const character = String.fromCodePoint(codePoint);
    bytes += utf8Encoder.encode(character).length;
    index += character.length;
  }
  byteToIndex.set(bytes, source.length);

  return function toSourceIndex(byteOffset: number, context: string) {
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      throw new Error(`Failed to transform Astro deck: invalid source offset for ${context}.`);
    }
    const index = byteToIndex.get(byteOffset);
    if (index === undefined) {
      throw new Error(
        `Failed to transform Astro deck: source offset ${byteOffset} is not a UTF-8 boundary for ${context}.`,
      );
    }
    return index;
  };
}
```

Notes:

- The `codePointAt` result can be asserted non-undefined because the loop
  condition guarantees `index < source.length` (a lone surrogate still
  returns its code unit value). Keep behavior for lone surrogates as today:
  `String.fromCodePoint` of a lone surrogate encodes to 3 bytes via
  TextEncoder's replacement behavior — identical to the old per-char path,
  since both use the same TextEncoder semantics.
- Error messages are byte-for-byte identical to the old ones.

### Step 2: Thread the converter through the two call sites

`getRequiredSpan` and `getPageAttributeInsertionOffset` currently take
`source` and call `toSourceIndex(source, offset, ctx)`. `analyzeAstroLayouts`
(line 236-250) is their only caller. Change:

1. `analyzeAstroLayouts` creates the converter once:
   `const toSourceIndex = createSourceIndexConverter(source);` and passes it
   (instead of / alongside `source`) to the two helpers.
2. `getRequiredSpan(toSourceIndex, node, context)` — same logic, calling
   `toSourceIndex(node.start, ...)` / `toSourceIndex(node.end, ...)`.
3. `getPageAttributeInsertionOffset(source, toSourceIndex, page, context)` —
   still needs `source` for the `source[endIndex - 2] === "/"` check
   (line 199-200); pass both.

Delete the old standalone `toSourceIndex` function.

**Verify**: `vp check` → exit 0. `vp run @deckup/cli#test` → exit 0; in
particular the Plan 001 emoji/CJK characterization test passes unchanged.

### Step 3: Add direct unit tests for the converter

Append to `apps/cli/tests/deckup-vite-plugins.test.ts`, importing
`createSourceIndexConverter`:

1. ASCII: for `"abc"`, offsets 0→0, 1→1, 3→3.
2. 2-byte char: `"aéb"` (é = 2 UTF-8 bytes): offset 0→0, 1→1, 3→2, 4→3.
3. 4-byte char (astral, surrogate pair in JS): `"a🎉b"`: offset 0→0, 1→1,
   5→3 (🎉 is 4 bytes, 2 JS code units), 6→4.
4. Non-boundary offset throws: `"é"` with offset 1 →
   `/is not a UTF-8 boundary/`.
5. Negative / non-integer offset throws: offset -1 and offset 1.5 →
   `/invalid source offset/`.
6. End-of-string boundary: `"ab"` offset 2 → 2.

**Verify**: `vp run @deckup/cli#test` → exit 0, including the 6 new tests.

### Step 4: Full verification

**Verify**: `vp run ready` → exit 0.

## Test plan

- Six direct unit tests (Step 3) in `apps/cli/tests/deckup-vite-plugins.test.ts`,
  modeled after the existing tests in that file (Plan 001 style).
- Regression: Plan 001's transform characterization tests (including the
  multi-byte deck) pass unchanged.

## Done criteria

- [ ] `vp run ready` exits 0
- [ ] `rg -n "new TextEncoder\(\)" apps/cli/src/deckup-vite-plugins.ts` shows exactly one occurrence (the module-level `utf8Encoder`)
- [ ] `createSourceIndexConverter` unit tests exist and pass (6 new tests)
- [ ] Plan 001 characterization tests pass unmodified
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `apps/cli/tests/deckup-vite-plugins.test.ts` does not exist (Plan 001 has
  not landed).
- `toSourceIndex` in the live code differs from the "Current state" excerpt
  (another plan or commit already changed it).
- The Plan 001 emoji/CJK test fails after the rewrite — the new converter
  disagrees with the old one on multi-byte input; report the failing offsets
  instead of tweaking the test.
- Plan 004 (duplication consolidation) has already moved these functions to a
  different file — apply the same change there and note it, but STOP if the
  moved code's shape differs from the excerpt.

## Maintenance notes

- The converter builds a Map over the whole source per transform. Deck files
  are small (KBs), so memory is a non-issue; if decks ever grow large, a
  sorted-array + binary search over only the offsets actually requested would
  be the next step.
- Reviewer: confirm error-message strings are unchanged (they are asserted
  by behavior-pinning tests and appear in user-facing errors).
