import { expect, test } from "vite-plus/test";

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

test("remarkDeckupMdxPages moves layout declarations to Page attributes", () => {
  const layoutNode = {
    type: "mdxJsxFlowElement",
    name: "layout",
    attributes: [{ type: "mdxJsxAttribute", name: "id", value: "section-intro" }],
    children: [],
  };
  const tree = {
    children: [layoutNode, { type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("section-intro");
  expect(tree.children[1]).toMatchObject({ children: [{ type: "heading" }] });
  expect(tree.children[2]).toMatchObject({ children: [{ type: "paragraph" }] });
});

test("remarkDeckupMdxPages preserves slot attributes on generated Page children", () => {
  const slottedNode = {
    type: "mdxJsxFlowElement",
    name: "div",
    attributes: [{ type: "mdxJsxAttribute", name: "slot", value: "left" }],
    children: [{ type: "text", value: "Left column" }],
  };
  const tree = {
    children: [
      {
        type: "mdxJsxFlowElement",
        name: "layout",
        attributes: [{ type: "mdxJsxAttribute", name: "id", value: "two-column" }],
        children: [],
      },
      { type: "heading" },
      slottedNode,
    ],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("two-column");
  expect(getPageChildren(tree.children[1])).toEqual([{ type: "heading" }, slottedNode]);
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
  const analysis = analyzeMdxDeckSource(
    `import Chart from "./Chart.astro";

<layout id="cover" />

# One

---

import Aside from "./Aside.astro";

<layout id="two-column" />

# Two
`,
    "/project/slides/talk.mdx",
  );

  expect(analysis.pageCount).toBe(2);
  expect(analysis.layouts).toEqual([{ layout: "cover" }, { layout: "two-column" }]);
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

test("countMdxDeckPages rejects duplicate layout declarations", () => {
  expect(() =>
    countMdxDeckPages(`<layout id="cover" />
<layout id="default" />

# One
`),
  ).toThrow(/multiple layout declarations/);
});

test("countMdxDeckPages rejects layout declarations without id", () => {
  expect(() =>
    countMdxDeckPages(`<layout />

# One
`),
  ).toThrow(/must include an id attribute/);
});

test("countMdxDeckPages rejects empty layout ids", () => {
  expect(() =>
    countMdxDeckPages(`<layout id="" />

# One
`),
  ).toThrow(/Invalid Deckup layout id/);
});

test("countMdxDeckPages rejects invalid layout ids", () => {
  expect(() =>
    countMdxDeckPages(`<layout id="Cover Slide" />

# One
`),
  ).toThrow(/Invalid Deckup layout id/);
});

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
