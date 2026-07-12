import { expect, test } from "vite-plus/test";

import {
  collectStaticAstroCodeBlocksForTests,
  countAstroDeckPages,
  createSourceIndexConverter,
  transformAstroDeckSource,
  transformAstroDeckSourceWithCodeHighlighting,
  validateAstroDeckSource,
} from "@deckup/core";

const twoPageDeck = `---
import Page from "@deckup/astro/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
<Page title="Details"><PageMeta layout="two-column" /><p>Body</p></Page>
`;

const codeBlockDeck = `---
import Page from "@deckup/astro/page";
---

<Page title="Code">
  <div>
    <pre><code class="language-ts">const slide = "日本語🎉";</code></pre>
  </div>
</Page>
`;

test("countAstroDeckPages counts top-level Astro Pages", () => {
  expect(countAstroDeckPages(twoPageDeck)).toBe(2);
});

test("validateAstroDeckSource returns the top-level Astro Page count", () => {
  expect(validateAstroDeckSource(twoPageDeck)).toBe(2);
});

test("public Astro transform moves PageMeta layout and removes the marker", () => {
  const result = transformAstroDeckSource(twoPageDeck);

  expect(result).toContain('<Page title="Intro" layout="cover">');
  expect(result).toContain('<Page title="Details" layout="two-column">');
  expect(result).not.toContain("PageMeta");
});

test("public Astro transform treats lowercase <layout> as ordinary content, not Deckup metadata", () => {
  const result = transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---
<Page><layout id="two-column" /><h1>One</h1></Page>`);

  expect(result).toContain('<Page layout="cover"><layout id="two-column" />');
  expect(result).not.toContain('layout="two-column"');
  expect(result).not.toContain("PageMeta");
});

test("public Astro transform rejects misplaced PageMeta", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---
<Page><h1>One</h1><PageMeta layout="cover" /></Page>`),
  ).toThrow(/first meaningful direct child/);
});

test("public Astro transform rejects unknown PageMeta attributes", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---
<Page><PageMeta layout="cover" extra="value" /></Page>`),
  ).toThrow(/exactly one layout attribute/);
});

test("public Astro transform rejects non-self-closing PageMeta", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---
<Page><PageMeta layout="cover"></PageMeta></Page>`),
  ).toThrow(/must be self-closing/);
});

test("transformAstroDeckSourceWithCodeHighlighting highlights static Astro code blocks", async () => {
  const result = await transformAstroDeckSourceWithCodeHighlighting(codeBlockDeck);

  expect(result).toContain('<Page title="Code" layout="cover">');
  expect(result).toContain('class="astro-code');
  expect(result).toContain('data-language="ts"');
  expect(result).toContain('style="');
  expect(result).toContain("日本語🎉");
  expect(result).toContain("<span");
  expect(result).not.toContain('<pre><code class="language-ts">');
});

test("transformAstroDeckSourceWithCodeHighlighting falls back for unknown languages", async () => {
  const result = await transformAstroDeckSourceWithCodeHighlighting(`---
import Page from "@deckup/astro/page";
---

<Page><pre><code class="language-deckup-unknown">const slide = 1;</code></pre></Page>
`);

  expect(result).toContain('class="astro-code');
  expect(result).toContain('data-language="deckup-unknown"');
  expect(result).toContain("const slide = 1;");
});

test("transformAstroDeckSourceWithCodeHighlighting leaves raw blocks unchanged when disabled", async () => {
  const result = await transformAstroDeckSourceWithCodeHighlighting(codeBlockDeck, "<deck>", {
    enabled: false,
  });

  expect(result).toBe(transformAstroDeckSource(codeBlockDeck));
  expect(result).toContain('<pre><code class="language-ts">const slide = "日本語🎉";</code></pre>');
});

test("transformAstroDeckSourceWithCodeHighlighting leaves unsupported dynamic code blocks unchanged", async () => {
  const source = `---
import Page from "@deckup/astro/page";
const language = "language-ts";
---

<Page><pre><code class={language}>const slide = 1;</code></pre></Page>
`;
  const result = await transformAstroDeckSourceWithCodeHighlighting(source);

  expect(result).toContain("class={language}");
  expect(result).toContain("const slide = 1;");
  expect(result).not.toContain('data-language="ts"');
});

test("transformAstroDeckSource uses default cover and content layouts", () => {
  const result = transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
<Page title="Details"><p>Body</p></Page>
`);

  expect(result).toContain('<Page title="Intro" layout="cover">');
  expect(result).toContain('<Page title="Details" layout="default">');
});

test("collectStaticAstroCodeBlocksForTests finds static language code blocks", () => {
  const blocks = collectStaticAstroCodeBlocksForTests(codeBlockDeck);

  expect(blocks).toEqual([
    {
      code: 'const slide = "日本語🎉";',
      language: "ts",
      span: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    },
  ]);
  expect(codeBlockDeck.slice(blocks[0].span.start, blocks[0].span.end)).toContain(
    '<pre><code class="language-ts">',
  );
});

test("collectStaticAstroCodeBlocksForTests preserves multibyte source spans", () => {
  const [block] = collectStaticAstroCodeBlocksForTests(codeBlockDeck);

  expect(codeBlockDeck.slice(block.span.start, block.span.end)).toBe(
    '<pre><code class="language-ts">const slide = "日本語🎉";</code></pre>',
  );
});

test("collectStaticAstroCodeBlocksForTests decodes escaped code text as static input", () => {
  const [block] = collectStaticAstroCodeBlocksForTests(`---
import Page from "@deckup/astro/page";
---

<Page><pre><code class="language-html">&lt;div&gt;safe&lt;/div&gt;</code></pre></Page>
`);

  expect(block).toMatchObject({
    code: "<div>safe</div>",
    language: "html",
  });
});

test("collectStaticAstroCodeBlocksForTests ignores pre blocks with author attributes", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@deckup/astro/page";
---

<Page><pre id="keep-me"><code class="language-ts">const slide = 1;</code></pre></Page>
`),
  ).toEqual([]);
});

test("collectStaticAstroCodeBlocksForTests ignores dynamic code classes", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@deckup/astro/page";
const language = "language-ts";
---

<Page><pre><code class={language}>const slide = 1;</code></pre></Page>
`),
  ).toEqual([]);
});

test("collectStaticAstroCodeBlocksForTests ignores non-text code children", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@deckup/astro/page";
---

<Page><pre><code class="language-ts"><span>const slide = 1;</span></code></pre></Page>
`),
  ).toEqual([]);
});

test("collectStaticAstroCodeBlocksForTests ignores code blocks without language classes", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@deckup/astro/page";
---

<Page><pre><code class="not-language-ts">const slide = 1;</code></pre></Page>
`),
  ).toEqual([]);
});

test("transformAstroDeckSource inserts layouts into self-closing Pages", () => {
  const result = transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---

<Page title="Solo" />
`);

  expect(result).toContain('<Page title="Solo"  layout="cover"/>');
});

test("Astro decks must import Page from @deckup/astro/page", () => {
  expect(() =>
    validateAstroDeckSource(`---
const title = "Intro";
---

<Page title={title} />
`),
  ).toThrow(/must import Page/);
});

test("Astro decks reject top-level non-Page content", () => {
  expect(() =>
    validateAstroDeckSource(`---
import Page from "@deckup/astro/page";
---

<Page />
<div>Not a slide</div>
`),
  ).toThrow(/top-level content must be <Page> components only/);
});

test("Astro decks require at least one top-level Page", () => {
  expect(() =>
    validateAstroDeckSource(`---
import Page from "@deckup/astro/page";
---

`),
  ).toThrow(/at least one top-level <Page>/);
});

test("Astro source transforms preserve offsets after multibyte text", () => {
  const emojiDeck = `---
import Page from "@deckup/astro/page";
---

<Page title="日本語🎉">
  <h1>絵文字 🚀 と CJK</h1>
</Page>
<Page>
  <PageMeta layout="two-column" />
  <p>after multibyte</p>
</Page>
`;
  const result = transformAstroDeckSource(emojiDeck);

  expect(result).toContain('<Page title="日本語🎉" layout="cover">');
  expect(result).toContain('<Page layout="two-column">');
  expect(result).not.toContain("PageMeta");
  expect(result).toContain("絵文字 🚀 と CJK");
});

test("createSourceIndexConverter maps ASCII byte offsets", () => {
  const toSourceIndex = createSourceIndexConverter("abc");

  expect(toSourceIndex(0, "test")).toBe(0);
  expect(toSourceIndex(1, "test")).toBe(1);
  expect(toSourceIndex(3, "test")).toBe(3);
});

test("createSourceIndexConverter maps two-byte UTF-8 characters", () => {
  const toSourceIndex = createSourceIndexConverter("aéb");

  expect(toSourceIndex(0, "test")).toBe(0);
  expect(toSourceIndex(1, "test")).toBe(1);
  expect(toSourceIndex(3, "test")).toBe(2);
  expect(toSourceIndex(4, "test")).toBe(3);
});

test("createSourceIndexConverter maps astral UTF-8 characters", () => {
  const toSourceIndex = createSourceIndexConverter("a🎉b");

  expect(toSourceIndex(0, "test")).toBe(0);
  expect(toSourceIndex(1, "test")).toBe(1);
  expect(toSourceIndex(5, "test")).toBe(3);
  expect(toSourceIndex(6, "test")).toBe(4);
});

test("createSourceIndexConverter rejects non-boundary offsets", () => {
  const toSourceIndex = createSourceIndexConverter("é");

  expect(() => toSourceIndex(1, "test")).toThrow(/is not a UTF-8 boundary/);
});

test("createSourceIndexConverter rejects invalid offsets", () => {
  const toSourceIndex = createSourceIndexConverter("abc");

  expect(() => toSourceIndex(-1, "test")).toThrow(/invalid source offset/);
  expect(() => toSourceIndex(1.5, "test")).toThrow(/invalid source offset/);
});

test("createSourceIndexConverter maps the end-of-string boundary", () => {
  const toSourceIndex = createSourceIndexConverter("ab");

  expect(toSourceIndex(2, "test")).toBe(2);
});
