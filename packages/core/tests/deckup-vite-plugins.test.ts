import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAst } from "vite-plus";
import { expect, test } from "vite-plus/test";

import {
  analyzeAstroDeckSourceForTests,
  collectStaticAstroCodeBlocksForTests,
  countAstroDeckPages,
  createDeckupVitePluginsForRegistry,
  createSourceIndexConverter,
  transformAstroDeckSource,
  transformAstroDeckSourceWithCodeHighlighting,
  transformCompiledAstroDeckSource,
  validateAstroDeckSource,
} from "../src/deckup-vite-plugins.ts";
import { createDeckRegistry } from "../src/deck.ts";

const twoPageDeck = `---
import Page from "@deckup/astro/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
<Page title="Details"><!-- page metadata --><PageMeta layout="two-column" /><p>Body</p></Page>
`;

const compiledTwoPages = [
  'const html = $$render`${$$renderComponent($$result, "Page", Page, { "title": "Intro" }, { "default": () => $$render`<h1>Intro</h1>` })}',
  '${$$renderComponent($$result, "Page", Page, {}, { "default": () => $$render`${$$renderComponent($$result, "PageMeta", PageMeta, { "layout": "two-column" })}<p>Body</p>` })}`;',
].join("\n");

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

test("transformAstroDeckSource injects layouts and removes PageMeta", () => {
  const result = transformAstroDeckSource(twoPageDeck);

  expect(result).toContain('<Page title="Intro" layout="cover">');
  expect(result).toContain('<Page title="Details" layout="two-column">');
  expect(result).toContain("<!-- page metadata -->");
  expect(result).not.toContain("PageMeta");
});

test("transformAstroDeckSource injects theme props when provided", () => {
  const result = transformAstroDeckSource(twoPageDeck, "<deck>", "minimal");

  expect(result).toContain('<Page title="Intro" layout="cover" theme="minimal">');
  expect(result).toContain('<Page title="Details" layout="two-column" theme="minimal">');
});

test("transformAstroDeckSource omits theme props when no theme is provided", () => {
  const result = transformAstroDeckSource(twoPageDeck);

  expect(result).toContain('layout="cover"');
  expect(result).not.toContain('theme="');
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

test("analyzeAstroDeckSourceForTests reads static theme metadata", () => {
  const analysis = analyzeAstroDeckSourceForTests(
    `---
import Page from "@deckup/astro/page";
const theme = "google-basic";
---

<Page title="Intro"><h1>Intro</h1></Page>
`,
    "/project/slides/intro.astro",
  );

  expect(analysis).toMatchObject({
    pageCount: 1,
    metadata: { theme: "google-basic" },
  });
});

test("analyzeAstroDeckSourceForTests rejects dynamic theme metadata with deck path", () => {
  expect(() =>
    analyzeAstroDeckSourceForTests(
      `---
import Page from "@deckup/astro/page";
const theme = process.env.DECKUP_THEME;
---

<Page />
`,
      "/project/slides/intro.astro",
    ),
  ).toThrow(
    /Astro deck theme metadata in \/project\/slides\/intro\.astro must be a static string literal/,
  );
});

test("analyzeAstroDeckSourceForTests rejects non-const theme metadata", () => {
  expect(() =>
    analyzeAstroDeckSourceForTests(
      `---
import Page from "@deckup/astro/page";
let theme = "minimal";
---

<Page />
`,
      "/project/slides/intro.astro",
    ),
  ).toThrow(/must use const theme =/);
});

test("analyzeAstroDeckSourceForTests rejects empty theme metadata", () => {
  expect(() =>
    analyzeAstroDeckSourceForTests(
      `---
import Page from "@deckup/astro/page";
const theme = "";
---

<Page />
`,
      "/project/slides/intro.astro",
    ),
  ).toThrow(/must be a non-empty string/);
});

const invalidAstroPageMetaCases: Array<[string, string, RegExp]> = [
  ["legacy layout marker", `<layout id="cover" />\n<h1>One</h1>`, /Legacy <layout> declaration/],
  ["nested legacy marker", `<div><layout id="cover" /></div>`, /Legacy <layout> declaration/],
  [
    "multiple declarations",
    `<PageMeta layout="cover" /><PageMeta layout="default" />`,
    /multiple PageMeta declarations/,
  ],
  ["missing layout", `<PageMeta />`, /exactly one layout attribute/],
  ["dynamic layout", `<PageMeta layout={layout} />`, /static string/],
  ["empty layout", `<PageMeta layout="" />`, /non-empty string/],
  ["invalid layout id", `<PageMeta layout="Cover Slide" />`, /Invalid Deckup layout id/],
  [
    "unknown attribute",
    `<PageMeta layout="cover" extra="value" />`,
    /exactly one layout attribute/,
  ],
  [
    "duplicate layout attribute",
    `<PageMeta layout="cover" layout="default" />`,
    /exactly one layout attribute/,
  ],
  ["spread attribute", `<PageMeta {...props} />`, /exactly one layout attribute/],
  ["non-self-closing marker", `<PageMeta layout="cover"></PageMeta>`, /must be self-closing/],
  ["marker children", `<PageMeta layout="cover">child</PageMeta>`, /must not have children/],
  [
    "late direct marker",
    `<h1>One</h1><PageMeta layout="cover" />`,
    /first meaningful direct child/,
  ],
  ["nested marker", `<div><PageMeta layout="cover" /></div>`, /first meaningful direct child/],
];

for (const [name, body, matcher] of invalidAstroPageMetaCases) {
  test(`Astro PageMeta ${name} fails identically in validation and transform`, () => {
    const source = `---
import Page from "@deckup/astro/page";
const layout = "cover";
const props = {};
---

<Page>${body}</Page>
`;
    expect(() => validateAstroDeckSource(source, "/project/slides/talk.astro")).toThrow(matcher);
    expect(() => transformAstroDeckSource(source, "/project/slides/talk.astro")).toThrow(matcher);
  });
}

test("Astro PageMeta may follow a non-rendering comment", () => {
  const result = transformAstroDeckSource(`---
import Page from "@deckup/astro/page";
---

<Page><!-- metadata --><PageMeta layout="section" /><h1>Section</h1></Page>
`);
  expect(result).toContain('layout="section"');
  expect(result).toContain("<!-- metadata -->");
  expect(result).not.toContain("PageMeta");
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

test("compiled Astro transforms inject layout props and remove PageMeta calls", () => {
  const result = transformCompiledAstroDeckSource(
    compiledTwoPages,
    [{ layout: "cover" }, { layout: "two-column", hasPageMeta: true }],
    "<deck>",
  );

  expect(result).toContain('{ "layout": "cover", "title": "Intro" }');
  expect(result).toContain('{ "layout": "two-column" }');
  expect(result).not.toContain("PageMeta");
  expect(result).toContain('${""}<p>Body</p>');
});

test("transformCompiledAstroDeckSource injects theme props when provided", () => {
  const result = transformCompiledAstroDeckSource(
    compiledTwoPages,
    [{ layout: "cover" }, { layout: "two-column", hasPageMeta: true }],
    "<deck>",
    "minimal",
  );

  expect(result).toContain('{ "theme": "minimal", "layout": "cover", "title": "Intro" }');
  expect(result).toContain('{ "theme": "minimal", "layout": "two-column" }');
});

test("compiled Astro transforms tolerate braces in string props", () => {
  const source =
    '$$renderComponent($$result, "Page", Page, { "title": "curly { not a brace }" }, {})';
  const result = transformCompiledAstroDeckSource(source, [{ layout: "cover" }], "<deck>");

  expect(result).toContain('"layout": "cover"');
  expect(result).toContain('"title": "curly { not a brace }"');
});

test("compiled Astro transforms throw when PageMeta count drifts from source analysis", () => {
  expect(() =>
    transformCompiledAstroDeckSource(
      compiledTwoPages,
      [{ layout: "cover" }, { layout: "two-column" }],
      "<deck>",
    ),
  ).toThrow(/compiled Page 2 PageMeta count 1 does not match analyzed marker count 0/);
});

test("compiled Astro transforms ignore PageMeta calls outside Page slots", () => {
  const source = [
    '$$renderComponent($$result, "PageMeta", PageMeta, { "layout": "outside" });',
    '$$renderComponent($$result, "Page", Page, {}, { "default": () => $$render`<p>Body</p>` });',
  ].join("\n");
  const result = transformCompiledAstroDeckSource(source, [{ layout: "cover" }], "<deck>");
  expect(result).toContain('"PageMeta", PageMeta');
  expect(result).toContain('"layout": "cover"');
});

test("compiled Astro transforms preserve multibyte spans before PageMeta", () => {
  const source = `const label = "日本語🎉";\n${compiledTwoPages}`;
  const result = transformCompiledAstroDeckSource(
    source,
    [{ layout: "cover" }, { layout: "two-column", hasPageMeta: true }],
    "<deck>",
  );
  expect(result).toContain('const label = "日本語🎉";');
  expect(result).not.toContain("PageMeta");
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
      virtualDeckModuleId: "virtual:deckup/decks/slides_deck",
      virtualRouteModuleId: "virtual:deckup/routes/slides_deck.astro",
    },
  ]);
  const plugins = createDeckupVitePluginsForRegistry(registry);
  const validation = plugins.find((plugin) => plugin.name === "deckup:astro-deck-validation");
  const transform = validation?.transform as
    | ((this: unknown, source: string, id: string) => unknown)
    | undefined;

  await expect(
    transform?.call({} as never, "<h1>Docs</h1>", "/project/src/pages/docs.astro"),
  ).resolves.toBeUndefined();
});

test("createDeckupVitePluginsForRegistry resolves and loads per-deck virtual ids", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-registry-vite-"));
  try {
    await mkdir(join(projectRoot, "src", "slides"), { recursive: true });
    const deckFile = join(projectRoot, "src", "slides", "intro.astro");
    await writeFile(
      deckFile,
      `---
import Page from "@deckup/astro/page";
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
      virtualDeckModuleId: "virtual:deckup/decks/slides_intro",
      virtualRouteModuleId: "virtual:deckup/routes/slides_intro.astro",
    };
    const registry = createDeckRegistry(projectRoot, "/slides", [deck]);
    const plugins = createDeckupVitePluginsForRegistry(registry);
    const virtualDeckPlugin = plugins.find((plugin) => plugin.name === "deckup:virtual-decks");
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

test("createDeckupVitePluginsForRegistry exposes all effective theme layout maps", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-registry-themes-"));
  try {
    await mkdir(join(projectRoot, "themes", "minimal", "layouts"), { recursive: true });
    await mkdir(join(projectRoot, "themes", "google-basic", "layouts"), { recursive: true });
    await writeFile(join(projectRoot, "themes", "minimal", "layouts", "cover.astro"), "<slot />\n");
    await writeFile(
      join(projectRoot, "themes", "google-basic", "layouts", "default.astro"),
      "<slot />\n",
    );
    const introDeck = {
      filePath: join(projectRoot, "src/slides/intro.astro"),
      projectRelativePath: "src/slides/intro.astro",
      format: "astro" as const,
      metadata: { theme: "minimal" },
      sourceGlob: "src/slides/*.astro",
      globBase: "src/slides",
      slug: "intro",
      routePath: "/slides/intro",
      routeId: "slides_intro",
      virtualDeckModuleId: "virtual:deckup/decks/slides_intro",
      virtualRouteModuleId: "virtual:deckup/routes/slides_intro.astro",
    };
    const guideDeck = {
      ...introDeck,
      filePath: join(projectRoot, "src/slides/guide.astro"),
      projectRelativePath: "src/slides/guide.astro",
      metadata: { theme: "google-basic" },
      slug: "guide",
      routePath: "/slides/guide",
      routeId: "slides_guide",
      virtualDeckModuleId: "virtual:deckup/decks/slides_guide",
      virtualRouteModuleId: "virtual:deckup/routes/slides_guide.astro",
    };
    const registry = createDeckRegistry(projectRoot, "/slides", [introDeck, guideDeck]);
    const minimalTheme = {
      name: "minimal",
      filePath: join(projectRoot, "themes/minimal/package.json"),
      packageName: "@deckup/theme-minimal",
      packageRoot: join(projectRoot, "themes/minimal"),
      layoutsDir: join(projectRoot, "themes/minimal/layouts"),
      layouts: [
        {
          id: "cover",
          filePath: join(projectRoot, "themes/minimal/layouts/cover.astro"),
          importPath: "/@fs/themes/minimal/layouts/cover.astro",
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "builtin" as const,
    };
    const googleBasicTheme = {
      name: "google-basic",
      filePath: join(projectRoot, "themes/google-basic/package.json"),
      packageName: "@deckup/theme-google-basic",
      packageRoot: join(projectRoot, "themes/google-basic"),
      layoutsDir: join(projectRoot, "themes/google-basic/layouts"),
      layouts: [
        {
          id: "default",
          filePath: join(projectRoot, "themes/google-basic/layouts/default.astro"),
          importPath: "/@fs/themes/google-basic/layouts/default.astro",
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "builtin" as const,
    };
    expect(() =>
      createDeckupVitePluginsForRegistry(
        registry,
        (deck) =>
          deck.projectRelativePath === "src/slides/intro.astro" ? minimalTheme : googleBasicTheme,
        { generatedPageFilePath: join(projectRoot, ".deckup", "Page.astro") },
      ),
    ).toThrow(/requires generatedPageFilePathForTheme/);
    const plugins = createDeckupVitePluginsForRegistry(
      registry,
      (deck) =>
        deck.projectRelativePath === "src/slides/intro.astro" ? minimalTheme : googleBasicTheme,
      {
        generatedPageFilePath: join(projectRoot, ".deckup", "Page.astro"),
        generatedPageFilePathForTheme: (themeName) =>
          join(projectRoot, ".deckup", `Page.${themeName}.astro`),
      },
    );
    const layoutsPlugin = plugins.find((plugin) => plugin.name === "deckup:virtual-theme-layouts");
    const resolveId = layoutsPlugin?.resolveId as
      | ((this: unknown, id: string) => string | undefined | Promise<string | undefined>)
      | undefined;
    const load = layoutsPlugin?.load as
      | ((
          this: { addWatchFile(filePath: string): void },
          id: string,
        ) => string | undefined | Promise<string | undefined>)
      | undefined;
    const resolved = await resolveId?.call({}, "virtual:deckup/theme-layouts");
    const source = await load?.call({ addWatchFile() {} }, resolved as string);

    expect(source).toContain('"minimal"');
    expect(source).toContain('"google-basic"');
    expect(source).toContain('"cover"');
    expect(source).toContain('"default"');

    const minimalResolved = await resolveId?.call({}, "virtual:deckup/theme-layouts?theme=minimal");
    const minimalSource = await load?.call({ addWatchFile() {} }, minimalResolved as string);
    expect(minimalSource).toContain('"minimal"');
    expect(minimalSource).toContain('"cover"');
    expect(minimalSource).not.toContain('"google-basic"');
    expect(minimalSource).not.toContain('"default"');

    const googleResolved = await resolveId?.call(
      {},
      "virtual:deckup/theme-layouts?theme=google-basic",
    );
    const googleSource = await load?.call({ addWatchFile() {} }, googleResolved as string);
    expect(googleSource).toContain('"google-basic"');
    expect(googleSource).toContain('"default"');
    expect(googleSource).not.toContain('"minimal"');
    expect(googleSource).not.toContain('"cover"');
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

test("registry Astro validation uses the matched deck effective theme", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-registry-theme-validation-"));
  try {
    await mkdir(join(projectRoot, "src", "slides"), { recursive: true });
    await mkdir(join(projectRoot, "themes", "minimal", "layouts"), { recursive: true });
    await mkdir(join(projectRoot, "themes", "google-basic", "layouts"), { recursive: true });
    await writeFile(join(projectRoot, "themes", "minimal", "layouts", "cover.astro"), "<slot />\n");
    await writeFile(
      join(projectRoot, "themes", "google-basic", "layouts", "default.astro"),
      "<slot />\n",
    );
    await writeFile(
      join(projectRoot, "src", "slides", "intro.astro"),
      `---
import /* keep */ Page from "@deckup/astro/page";
---

<Page><PageMeta layout="cover" /><h1>Intro</h1></Page>
`,
    );
    await writeFile(
      join(projectRoot, "src", "slides", "guide.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page><PageMeta layout="cover" /><h1>Guide</h1></Page>
`,
    );
    const introDeck = {
      filePath: join(projectRoot, "src/slides/intro.astro"),
      projectRelativePath: "src/slides/intro.astro",
      format: "astro" as const,
      sourceGlob: "src/slides/*.astro",
      globBase: "src/slides",
      slug: "intro",
      routePath: "/slides/intro",
      routeId: "slides_intro",
      virtualDeckModuleId: "virtual:deckup/decks/slides_intro",
      virtualRouteModuleId: "virtual:deckup/routes/slides_intro.astro",
    };
    const guideDeck = {
      ...introDeck,
      filePath: join(projectRoot, "src/slides/guide.astro"),
      projectRelativePath: "src/slides/guide.astro",
      slug: "guide",
      routePath: "/slides/guide",
      routeId: "slides_guide",
      virtualDeckModuleId: "virtual:deckup/decks/slides_guide",
      virtualRouteModuleId: "virtual:deckup/routes/slides_guide.astro",
    };
    const registry = createDeckRegistry(projectRoot, "/slides", [introDeck, guideDeck]);
    const minimalTheme = {
      name: "minimal",
      filePath: join(projectRoot, "themes/minimal/package.json"),
      packageRoot: join(projectRoot, "themes/minimal"),
      layoutsDir: join(projectRoot, "themes/minimal/layouts"),
      layouts: [
        {
          id: "cover",
          filePath: join(projectRoot, "themes/minimal/layouts/cover.astro"),
          importPath: "/@fs/themes/minimal/layouts/cover.astro",
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "builtin" as const,
    };
    const googleBasicTheme = {
      name: "google-basic",
      filePath: join(projectRoot, "themes/google-basic/package.json"),
      packageRoot: join(projectRoot, "themes/google-basic"),
      layoutsDir: join(projectRoot, "themes/google-basic/layouts"),
      layouts: [
        {
          id: "default",
          filePath: join(projectRoot, "themes/google-basic/layouts/default.astro"),
          importPath: "/@fs/themes/google-basic/layouts/default.astro",
          slotNames: [],
        },
      ],
      slotNames: [],
      source: "builtin" as const,
    };
    const validation = createDeckupVitePluginsForRegistry(
      registry,
      (deck) =>
        deck.projectRelativePath === "src/slides/intro.astro" ? minimalTheme : googleBasicTheme,
      {
        generatedPageFilePathForTheme: (themeName) =>
          join(projectRoot, ".deckup", `Page.${themeName}.astro`),
      },
    ).find((plugin) => plugin.name === "deckup:astro-deck-validation");
    const load = validation?.load as
      | ((this: unknown, id: string) => Promise<string | undefined>)
      | undefined;

    const introSource = await load?.call({}, introDeck.filePath);
    expect(introSource).toContain('theme="minimal"');
    expect(introSource).toContain("import /* keep */ Page from");
    expect(introSource).toContain("/.deckup/Page.minimal.astro");
    expect(introSource).not.toContain('from "@deckup/astro/page"');
    await expect(load?.call({}, guideDeck.filePath)).rejects.toThrow(
      /Deckup theme "google-basic" does not provide layout "cover" required by src\/slides\/guide\.astro/,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

test("registry compiled fallback uses the injected Vite parser with multibyte input", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-compiled-parser-"));
  try {
    await mkdir(join(projectRoot, "src", "slides"), { recursive: true });
    const deckFile = join(projectRoot, "src", "slides", "intro.astro");
    await writeFile(
      deckFile,
      `---
import Page from "@deckup/astro/page";
---
<Page><PageMeta layout="section" /><h1>Intro</h1></Page>`,
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
      virtualDeckModuleId: "virtual:deckup/decks/slides_intro",
      virtualRouteModuleId: "virtual:deckup/routes/slides_intro.astro",
    };
    const validation = createDeckupVitePluginsForRegistry(
      createDeckRegistry(projectRoot, "/slides", [deck]),
    ).find((plugin) => plugin.name === "deckup:astro-deck-validation");
    const transform = validation?.transform as
      | ((this: { parse(source: string): unknown }, source: string, id: string) => Promise<string>)
      | undefined;
    let parseCalls = 0;
    const compiled =
      'const label = "日本語🎉";\n$$renderComponent($$result, "Page", Page, {}, { "default": () => $$render`${$$renderComponent($$result, "PageMeta", PageMeta, { "layout": "section" })}<h1>Intro</h1>` })';
    const result = await transform?.call(
      {
        parse(source) {
          parseCalls++;
          return parseAst(source);
        },
      },
      compiled,
      deckFile,
    );
    expect(parseCalls).toBe(1);
    expect(result).toContain('const label = "日本語🎉";');
    expect(result).toContain('"layout": "section"');
    expect(result).not.toContain("PageMeta");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
