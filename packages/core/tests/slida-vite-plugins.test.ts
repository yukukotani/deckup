import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

import {
  collectStaticAstroCodeBlocksForTests,
  countAstroDeckPages,
  createSlidaVitePluginsForRegistry,
  createSourceIndexConverter,
  transformAstroDeckSource,
  transformAstroDeckSourceWithCodeHighlighting,
  transformCompiledAstroDeckSource,
  validateAstroDeckSource,
} from "../src/slida-vite-plugins.ts";
import { createDeckRegistry } from "../src/deck.ts";

const twoPageDeck = `---
import Page from "@slida/astro/page";
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

const codeBlockDeck = `---
import Page from "@slida/astro/page";
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

test("transformAstroDeckSource injects explicit and default layouts", () => {
  const result = transformAstroDeckSource(twoPageDeck);

  expect(result).toContain('<Page title="Intro" layout="cover">');
  expect(result).toContain('<Page title="Details" layout="two-column">');
  expect(result).not.toContain("<layout");
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
import Page from "@slida/astro/page";
---

<Page><pre><code class="language-slida-unknown">const slide = 1;</code></pre></Page>
`);

  expect(result).toContain('class="astro-code');
  expect(result).toContain('data-language="slida-unknown"');
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
import Page from "@slida/astro/page";
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
import Page from "@slida/astro/page";
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
import Page from "@slida/astro/page";
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
import Page from "@slida/astro/page";
---

<Page><pre id="keep-me"><code class="language-ts">const slide = 1;</code></pre></Page>
`),
  ).toEqual([]);
});

test("collectStaticAstroCodeBlocksForTests ignores dynamic code classes", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@slida/astro/page";
const language = "language-ts";
---

<Page><pre><code class={language}>const slide = 1;</code></pre></Page>
`),
  ).toEqual([]);
});

test("collectStaticAstroCodeBlocksForTests ignores non-text code children", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@slida/astro/page";
---

<Page><pre><code class="language-ts"><span>const slide = 1;</span></code></pre></Page>
`),
  ).toEqual([]);
});

test("collectStaticAstroCodeBlocksForTests ignores code blocks without language classes", () => {
  expect(
    collectStaticAstroCodeBlocksForTests(`---
import Page from "@slida/astro/page";
---

<Page><pre><code class="not-language-ts">const slide = 1;</code></pre></Page>
`),
  ).toEqual([]);
});

test("transformAstroDeckSource inserts layouts into self-closing Pages", () => {
  const result = transformAstroDeckSource(`---
import Page from "@slida/astro/page";
---

<Page title="Solo" />
`);

  expect(result).toContain('<Page title="Solo"  layout="cover"/>');
});

test("Astro decks must import Page from @slida/astro/page", () => {
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
import Page from "@slida/astro/page";
---

<Page />
<div>Not a slide</div>
`),
  ).toThrow(/top-level content must be <Page> components only/);
});

test("Astro decks require at least one top-level Page", () => {
  expect(() =>
    validateAstroDeckSource(`---
import Page from "@slida/astro/page";
---

`),
  ).toThrow(/at least one top-level <Page>/);
});

test("Astro Pages reject multiple layout declarations", () => {
  expect(() =>
    transformAstroDeckSource(`---
import Page from "@slida/astro/page";
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
import Page from "@slida/astro/page";
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
import Page from "@slida/astro/page";
---

<Page>
  <layout id="cover"></layout>
</Page>
`),
  ).toThrow(/must be self-closing/);
});

test("Astro source transforms preserve offsets after multibyte text", () => {
  const emojiDeck = `---
import Page from "@slida/astro/page";
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

test("registry Astro validation leaves non-deck Astro modules untouched", async () => {
  const registry = createDeckRegistry("/project", "/slides", [
    {
      filePath: "/project/src/slides/deck.astro",
      projectRelativePath: "src/slides/deck.astro",
      format: "astro",
      sourceGlob: "src/slides/*.astro",
      globBase: "src/slides",
      slug: "deck",
      routePath: "/slides/deck",
      routeId: "slides_deck",
      virtualDeckModuleId: "virtual:slida/decks/slides_deck",
      virtualRouteModuleId: "virtual:slida/routes/slides_deck.astro",
    },
  ]);
  const plugins = createSlidaVitePluginsForRegistry(registry);
  const validation = plugins.find((plugin) => plugin.name === "slida:astro-deck-validation");
  const transform = validation?.transform as
    | ((this: unknown, source: string, id: string) => unknown)
    | undefined;

  await expect(
    transform?.call({} as never, "<h1>Docs</h1>", "/project/src/pages/docs.astro"),
  ).resolves.toBeUndefined();
});

test("createSlidaVitePluginsForRegistry resolves and loads per-deck virtual ids", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-registry-vite-"));
  try {
    await mkdir(join(projectRoot, "src", "slides"), { recursive: true });
    const deckFile = join(projectRoot, "src", "slides", "intro.astro");
    await writeFile(
      deckFile,
      `---
import Page from "@slida/astro/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
`,
    );
    const deck = {
      filePath: deckFile,
      projectRelativePath: "src/slides/intro.astro",
      format: "astro" as const,
      sourceGlob: "src/slides/*.astro",
      globBase: "src/slides",
      slug: "intro",
      routePath: "/slides/intro",
      routeId: "slides_intro",
      virtualDeckModuleId: "virtual:slida/decks/slides_intro",
      virtualRouteModuleId: "virtual:slida/routes/slides_intro.astro",
    };
    const registry = createDeckRegistry(projectRoot, "/slides", [deck]);
    const plugins = createSlidaVitePluginsForRegistry(registry);
    const virtualDeckPlugin = plugins.find((plugin) => plugin.name === "slida:virtual-decks");
    const resolveId = virtualDeckPlugin?.resolveId as
      | ((this: unknown, id: string) => string | undefined | Promise<string | undefined>)
      | undefined;
    const load = virtualDeckPlugin?.load as
      | ((
          this: { addWatchFile(filePath: string): void },
          id: string,
        ) => string | undefined | Promise<string | undefined>)
      | undefined;

    expect(await resolveId?.call({}, deck.virtualDeckModuleId)).toBe(
      `\0${deck.virtualDeckModuleId}`,
    );
    const watched: string[] = [];
    const source = await load?.call(
      { addWatchFile: (filePath) => watched.push(filePath) },
      `\0${deck.virtualDeckModuleId}`,
    );

    expect(watched).toContain(deckFile);
    expect(source).toContain('import Deck from "/src/slides/intro.astro";');
    expect(source).toContain('pageCount":1');
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
