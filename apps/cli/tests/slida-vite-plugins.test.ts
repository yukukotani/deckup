import { expect, test } from "vite-plus/test";

import {
  countAstroDeckPages,
  createSourceIndexConverter,
  transformAstroDeckSource,
  transformCompiledAstroDeckSource,
  validateAstroDeckSource,
} from "../src/slida-vite-plugins.ts";

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

const compiledTwoPages = [
  'const html = $$render`${$$renderComponent($$result, "Page", Page, { "title": "Intro" }, { "default": () => $$render`<h1>Intro</h1>` })}',
  '${$$renderComponent($$result, "Page", Page, {}, { "default": () => $$render`<layout id="two-column"></layout><p>Body</p>` })}`;',
].join("\n");

test("countAstroDeckPages counts top-level Astro Pages", () => {
  expect(countAstroDeckPages(twoPageDeck)).toBe(2);
});

test("validateAstroDeckSource returns the top-level Astro Page count", () => {
  expect(validateAstroDeckSource(twoPageDeck)).toBe(2);
});

test("transformAstroDeckSource injects explicit and default layouts", () => {
  const result = transformAstroDeckSource(twoPageDeck);

  expect(result).toContain('<Page title="Intro" layout="cover">');
  expect(result).toContain('<Page title="Details" layout="two-column">');
  expect(result).not.toContain("<layout");
});

test("transformAstroDeckSource uses default cover and content layouts", () => {
  const result = transformAstroDeckSource(`---
import Page from "@slida/cli/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
<Page title="Details"><p>Body</p></Page>
`);

  expect(result).toContain('<Page title="Intro" layout="cover">');
  expect(result).toContain('<Page title="Details" layout="default">');
});

test("transformAstroDeckSource inserts layouts into self-closing Pages", () => {
  const result = transformAstroDeckSource(`---
import Page from "@slida/cli/page";
---

<Page title="Solo" />
`);

  expect(result).toContain('<Page title="Solo"  layout="cover"/>');
});

test("Astro decks must import Page from @slida/cli/page", () => {
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
import Page from "@slida/cli/page";
---

<Page />
<div>Not a slide</div>
`),
  ).toThrow(/top-level content must be <Page> components only/);
});

test("Astro decks require at least one top-level Page", () => {
  expect(() =>
    validateAstroDeckSource(`---
import Page from "@slida/cli/page";
---

`),
  ).toThrow(/at least one top-level <Page>/);
});

test("Astro Pages reject multiple layout declarations", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@slida/cli/page";
---

<Page>
  <layout id="cover" />
  <layout id="default" />
</Page>
`),
  ).toThrow(/multiple layout declarations/);
});

test("Astro layout declarations require a string id", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@slida/cli/page";
const expr = "cover";
---

<Page>
  <layout id={expr} />
</Page>
`),
  ).toThrow(/string id attribute/);
});

test("Astro layout declarations must be self-closing", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@slida/cli/page";
---

<Page>
  <layout id="cover"></layout>
</Page>
`),
  ).toThrow(/must be self-closing/);
});

test("Astro source transforms preserve offsets after multibyte text", () => {
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
  const result = transformAstroDeckSource(emojiDeck);

  expect(result).toContain('<Page title="日本語🎉" layout="cover">');
  expect(result).toContain('<Page layout="two-column">');
  expect(result).not.toContain("<layout");
  expect(result).toContain("絵文字 🚀 と CJK");
});

test("compiled Astro transforms inject layout props first and strip layout remnants", () => {
  const result = transformCompiledAstroDeckSource(
    compiledTwoPages,
    [{ layout: "cover" }, { layout: "two-column" }],
    "<deck>",
  );

  expect(result).toContain('{ "layout": "cover", "title": "Intro" }');
  expect(result).toContain('{ "layout": "two-column" }');
  expect(result).not.toContain("<layout");
});

test("compiled Astro transforms tolerate braces in string props", () => {
  const source =
    '$$renderComponent($$result, "Page", Page, { "title": "curly { not a brace }" }, {})';
  const result = transformCompiledAstroDeckSource(source, [{ layout: "cover" }], "<deck>");

  expect(result).toContain('"layout": "cover"');
  expect(result).toContain('"title": "curly { not a brace }"');
});

test("compiled Astro transforms throw when compiled Page count mismatches", () => {
  expect(() =>
    transformCompiledAstroDeckSource(compiledTwoPages, [{ layout: "cover" }], "<deck>"),
  ).toThrow(/compiled Page count 2 does not match analyzed page count 1/);
});

test("compiled Astro transforms tolerate whitespace in Page render calls", () => {
  const source = [
    '$$renderComponent(\n  $$result,\n  "Page",\n  Page,\n  { "title": "Intro" }, {})',
  ].join("\n");
  const result = transformCompiledAstroDeckSource(source, [{ layout: "cover" }], "<deck>");

  expect(result).toContain('"layout": "cover"');
});

test("compiled Astro transforms ignore non-Page render calls", () => {
  const source = '$$renderComponent($$result, "Other", Other, { "title": "Intro" }, {})';

  expect(transformCompiledAstroDeckSource(source, [], "<deck>")).toBe(source);
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
