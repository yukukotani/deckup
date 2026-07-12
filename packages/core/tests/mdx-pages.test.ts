import { expect, test } from "vite-plus/test";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import {
  analyzeMdxDeckMetadata,
  analyzeMdxDeckSource,
  countMdxDeckPages,
  remarkDeckupMdxPages,
  splitMdxChildrenIntoPages,
  stripMdxFrontmatter,
} from "../src/deckup-mdx-pages.ts";
import { createDeckRegistry } from "../src/deck.ts";

const twoPageMdx = `---
title: Talk
---

# One

---

# Two
`;
const deckFile = "/project/slides/talk.mdx";

function transformMdxSource(source: string) {
  const tree = unified().use(remarkParse).use(remarkMdx).parse(source);
  remarkDeckupMdxPages({ deckFile })(tree as never, { path: deckFile, value: source });
  return tree as unknown as { children: unknown[] };
}

function getPageLayout(node: unknown) {
  return (node as { attributes?: Array<{ name?: string; value?: unknown }> }).attributes?.find(
    (attribute) => attribute.name === "layout",
  )?.value;
}

function getPageChildren(node: unknown) {
  return (node as { children?: unknown[] }).children ?? [];
}

test("stripMdxFrontmatter preserves post-frontmatter divider content", () => {
  expect(stripMdxFrontmatter(twoPageMdx)).toBe(`
# One

---

# Two
`);
});

test("countMdxDeckPages counts thematicBreak dividers through the same mdast splitter", () => {
  expect(countMdxDeckPages(twoPageMdx)).toBe(2);
});

test("countMdxDeckPages rejects empty pages", () => {
  expect(() =>
    countMdxDeckPages(`# One

---

---

# Three
`),
  ).toThrow(/empty page/);
});

test("splitMdxChildrenIntoPages splits thematicBreak nodes", () => {
  expect(
    splitMdxChildrenIntoPages([
      { type: "heading" },
      { type: "thematicBreak" },
      { type: "paragraph" },
    ]),
  ).toEqual([[{ type: "heading" }], [{ type: "paragraph" }]]);
});

test("remarkDeckupMdxPages wraps only the selected file in Page nodes", () => {
  const tree = {
    children: [{ type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(tree.children[0]).toMatchObject({ type: "mdxjsEsm" });
  expect(tree.children[1]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
  expect(tree.children[2]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
});

test("remarkDeckupMdxPages adds default layout attributes", () => {
  const tree = {
    children: [{ type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("cover");
  expect(getPageLayout(tree.children[2])).toBe("default");
});

test("remarkDeckupMdxPages adds theme attributes when themeForDeck returns an effective theme", () => {
  const tree = { children: [{ type: "heading" }] };
  remarkDeckupMdxPages({
    deckFile: "/project/slides/talk.mdx",
    themeForDeck: () => "minimal",
  })(tree, { path: "/project/slides/talk.mdx" });

  expect((tree.children[1] as { attributes?: unknown[] }).attributes).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "theme", value: "minimal" })]),
  );
});

test("remarkDeckupMdxPages moves PageMeta layout to Page attributes", () => {
  const tree = transformMdxSource(`<PageMeta layout="section-intro" />

# Intro

---

# Details
`);
  expect(getPageLayout(tree.children[1])).toBe("section-intro");
  expect(tree.children[1]).toMatchObject({
    children: [expect.objectContaining({ type: "heading" })],
  });
  expect(getPageLayout(tree.children[2])).toBe("default");
});

test("remarkDeckupMdxPages preserves slot attributes after removing PageMeta", () => {
  const tree = transformMdxSource(`<PageMeta layout="two-column" />

# Columns

<div slot="left">
  Left column
</div>
`);
  expect(getPageLayout(tree.children[1])).toBe("two-column");
  expect(getPageChildren(tree.children[1])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "heading" }),
      expect.objectContaining({
        type: "mdxJsxFlowElement",
        name: "div",
        attributes: expect.arrayContaining([
          expect.objectContaining({ name: "slot", value: "left" }),
        ]),
      }),
    ]),
  );
});

test("PageMeta may follow non-rendering MDX comments", () => {
  const source = `{/* page metadata follows */}

<PageMeta layout="section" />

# Section
`;
  const tree = transformMdxSource(source);
  expect(getPageLayout(tree.children[1])).toBe("section");
  expect(getPageChildren(tree.children[1])).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "mdxFlowExpression" })]),
  );
  expect(analyzeMdxDeckSource(source, deckFile).layouts).toEqual([{ layout: "section" }]);
});

test("remarkDeckupMdxPages keeps author-side slot elements as content", () => {
  const authorSlotNode = {
    type: "mdxJsxFlowElement",
    name: "slot",
    attributes: [{ type: "mdxJsxAttribute", name: "name", value: "left" }],
    children: [{ type: "paragraph" }],
  };
  const tree = { children: [authorSlotNode, { type: "heading" }] };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("cover");
  expect(getPageChildren(tree.children[1])).toEqual([authorSlotNode, { type: "heading" }]);
});

test("remarkDeckupMdxPages keeps user MDX ESM outside generated Page nodes", () => {
  const tree = {
    children: [
      { type: "mdxjsEsm", value: "import Chart from './Chart.astro';" },
      { type: "heading" },
    ],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(tree.children[0]).toMatchObject({ type: "mdxjsEsm" });
  expect(tree.children[1]).toMatchObject({
    type: "mdxjsEsm",
    value: "import Chart from './Chart.astro';",
  });
  expect(tree.children[2]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
});

test("analyzeMdxDeckSource ignores MDX ESM nodes like the renderer", () => {
  const source = `import Chart from "./Chart.astro";

<PageMeta layout="cover" />

# One

---

import Aside from "./Aside.astro";

<PageMeta layout="two-column" />

# Two
`;
  const analysis = analyzeMdxDeckSource(source, deckFile);
  const tree = transformMdxSource(source);

  expect(analysis.pageCount).toBe(2);
  expect(analysis.layouts).toEqual([{ layout: "cover" }, { layout: "two-column" }]);
  expect(getPageLayout(tree.children.at(-2))).toBe("cover");
  expect(getPageLayout(tree.children.at(-1))).toBe("two-column");
});

test("analyzeMdxDeckMetadata reads static theme frontmatter", () => {
  expect(
    analyzeMdxDeckMetadata(
      `---
title: Talk
theme: google-basic
---

# One
`,
      "/project/slides/talk.mdx",
    ),
  ).toEqual({ theme: "google-basic" });
});

test("analyzeMdxDeckSource includes static metadata", () => {
  const analysis = analyzeMdxDeckSource(
    `---
title: Talk
theme: "minimal"
---

# One
`,
    "/project/slides/talk.mdx",
  );

  expect(analysis.metadata).toEqual({ theme: "minimal" });
  expect(analysis.pageCount).toBe(1);
});

test("analyzeMdxDeckMetadata ignores files without frontmatter theme", () => {
  expect(analyzeMdxDeckMetadata("# One\n", "/project/slides/talk.mdx")).toEqual({});
});

test("analyzeMdxDeckMetadata rejects non-string theme metadata with deck path", () => {
  expect(() =>
    analyzeMdxDeckMetadata(
      `---
theme: false
---

# One
`,
      "/project/slides/talk.mdx",
    ),
  ).toThrow(
    /MDX deck theme metadata in \/project\/slides\/talk\.mdx line 1 must be a static string/,
  );
});

test("analyzeMdxDeckMetadata rejects empty theme metadata with deck path", () => {
  expect(() =>
    analyzeMdxDeckMetadata(
      `---
theme: ""
---

# One
`,
      "/project/slides/talk.mdx",
    ),
  ).toThrow(
    /MDX deck theme metadata in \/project\/slides\/talk\.mdx line 1 must be a non-empty string/,
  );
});

test("analyzeMdxDeckMetadata rejects malformed quoted theme metadata with deck path", () => {
  expect(() =>
    analyzeMdxDeckMetadata(
      String.raw`---
theme: "bad\q"
---

# One
`,
      "/project/slides/talk.mdx",
    ),
  ).toThrow(
    /MDX deck theme metadata in \/project\/slides\/talk\.mdx line 1 must be a static string/,
  );
});

test("remarkDeckupMdxPages leaves non-selected files untouched", () => {
  const tree = { children: [{ type: "heading" }] };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/other.mdx",
  });
  expect(tree.children).toEqual([{ type: "heading" }]);
});

test("MDX decks treat lowercase <layout> as ordinary content, not Deckup metadata", () => {
  const source = `<layout id="two-column" />\n\n# One\n`;

  const analysis = analyzeMdxDeckSource(source, deckFile);
  expect(analysis.pageCount).toBe(1);
  expect(analysis.layouts).toEqual([{ layout: "cover" }]);

  const tree = transformMdxSource(source);
  expect(getPageLayout(tree.children[1])).toBe("cover");
  expect(getPageChildren(tree.children[1])).toContainEqual(
    expect.objectContaining({ type: "mdxJsxFlowElement", name: "layout" }),
  );
});

test("MDX decks treat a nested lowercase <layout> as ordinary content, not Deckup metadata", () => {
  const source = `<p>Before <layout id="two-column" /></p>\n`;

  const analysis = analyzeMdxDeckSource(source, deckFile);
  expect(analysis.pageCount).toBe(1);
  expect(analysis.layouts).toEqual([{ layout: "cover" }]);
});

const invalidPageMetaCases: Array<[string, string, RegExp]> = [
  [
    "multiple declarations",
    `<PageMeta layout="cover" />\n<PageMeta layout="default" />\n\n# One\n`,
    /multiple PageMeta declarations/,
  ],
  ["missing layout", `<PageMeta />\n\n# One\n`, /exactly one layout attribute/],
  ["dynamic layout", `<PageMeta layout={layout} />\n\n# One\n`, /static string/],
  ["empty layout", `<PageMeta layout="" />\n\n# One\n`, /non-empty string/],
  ["invalid layout id", `<PageMeta layout="Cover Slide" />\n\n# One\n`, /Invalid Deckup layout id/],
  [
    "unknown attribute",
    `<PageMeta layout="cover" extra="value" />\n\n# One\n`,
    /exactly one layout attribute/,
  ],
  [
    "duplicate layout attribute",
    `<PageMeta layout="cover" layout="default" />\n\n# One\n`,
    /exactly one layout attribute/,
  ],
  ["spread attribute", `<PageMeta {...props} />\n\n# One\n`, /exactly one layout attribute/],
  [
    "non-self-closing marker",
    `<PageMeta layout="cover"></PageMeta>\n\n# One\n`,
    /must be self-closing/,
  ],
  [
    "marker children",
    `<PageMeta layout="cover">child</PageMeta>\n\n# One\n`,
    /must not have children/,
  ],
  ["late direct marker", `# One\n\n<PageMeta layout="cover" />\n`, /first meaningful direct child/],
  [
    "nested flow marker",
    `<div>\n<PageMeta layout="cover" />\n</div>\n`,
    /first meaningful direct child/,
  ],
  [
    "nested text marker",
    `<p>Before <PageMeta layout="cover" /></p>\n`,
    /first meaningful direct child/,
  ],
];

for (const [name, source, matcher] of invalidPageMetaCases) {
  test(`MDX PageMeta ${name} fails identically in transform and analysis`, () => {
    expect(() => transformMdxSource(source)).toThrow(matcher);
    expect(() => analyzeMdxDeckSource(source, deckFile)).toThrow(matcher);
  });
}

test("remarkDeckupMdxPages selects decks through a multi-deck registry", () => {
  const talkDeck = {
    filePath: "/project/src/slides/talk.mdx",
    projectRelativePath: "src/slides/talk.mdx",
    format: "mdx" as const,
    sourceGlob: "src/slides/*.mdx",
    globBase: "src/slides",
    slug: "talk",
    routePath: "/slides/talk",
    routeId: "slides_talk",
    virtualDeckModuleId: "virtual:deckup/decks/slides_talk",
    virtualRouteModuleId: "virtual:deckup/routes/slides_talk.astro",
  };
  const guideDeck = {
    ...talkDeck,
    filePath: "/project/src/slides/guide.mdx",
    projectRelativePath: "src/slides/guide.mdx",
    slug: "guide",
    routePath: "/slides/guide",
    routeId: "slides_guide",
    virtualDeckModuleId: "virtual:deckup/decks/slides_guide",
    virtualRouteModuleId: "virtual:deckup/routes/slides_guide.astro",
  };
  const registry = createDeckRegistry("/project", "/slides", [talkDeck, guideDeck]);
  const tree = {
    children: [{ type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };

  remarkDeckupMdxPages({ registry })(tree, {
    path: "/project/src/slides/guide.mdx",
  });

  expect(tree.children[0]).toMatchObject({
    type: "mdxjsEsm",
    value: 'import Page from "@deckup/astro/page";',
  });
  expect(tree.children[1]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
  expect(tree.children[2]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
});

test("remarkDeckupMdxPages selects a deck-specific Page component", () => {
  const deck = {
    filePath: "/project/src/slides/talk.mdx",
    projectRelativePath: "src/slides/talk.mdx",
    format: "mdx" as const,
    sourceGlob: "src/slides/*.mdx",
    globBase: "src/slides",
    slug: "talk",
    routePath: "/slides/talk",
    routeId: "slides_talk",
    virtualDeckModuleId: "virtual:deckup/decks/slides_talk",
    virtualRouteModuleId: "virtual:deckup/routes/slides_talk.astro",
  };
  const registry = createDeckRegistry("/project", "/slides", [deck]);
  const tree = { children: [{ type: "heading" }] };

  remarkDeckupMdxPages({
    registry,
    pageComponentForDeck: () => "/@fs/project/.deckup/Page.minimal.astro",
  })(tree, { path: deck.filePath });

  expect(tree.children[0]).toMatchObject({
    type: "mdxjsEsm",
    value: 'import Page from "/@fs/project/.deckup/Page.minimal.astro";',
  });
});
