import { expect, test } from "vite-plus/test";

import {
  analyzeMdxDeckSource,
  countMdxDeckPages,
  remarkDeckupMdxPages,
  splitMdxChildrenIntoPages,
  stripMdxFrontmatter,
} from "@deckup/core";

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

function createSourceBackedPageMeta(layout: string) {
  const source = `<PageMeta layout="${layout}" />`;
  return {
    source,
    node: {
      type: "mdxJsxFlowElement",
      name: "PageMeta",
      attributes: [{ type: "mdxJsxAttribute", name: "layout", value: layout }],
      children: [],
      position: { start: { offset: 0 }, end: { offset: source.length } },
    },
  };
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

test("remarkDeckupMdxPages moves PageMeta layout to Page attributes", () => {
  const { node, source } = createSourceBackedPageMeta("section-intro");
  const tree = {
    children: [node, { type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
    value: source,
  });

  expect(getPageLayout(tree.children[1])).toBe("section-intro");
  expect(tree.children[1]).toMatchObject({ children: [{ type: "heading" }] });
  expect(tree.children[2]).toMatchObject({ children: [{ type: "paragraph" }] });
});

test("remarkDeckupMdxPages preserves slot attributes after removing PageMeta", () => {
  const { node, source } = createSourceBackedPageMeta("two-column");
  const slottedNode = {
    type: "mdxJsxFlowElement",
    name: "div",
    attributes: [{ type: "mdxJsxAttribute", name: "slot", value: "left" }],
    children: [{ type: "text", value: "Left column" }],
  };
  const tree = {
    children: [node, { type: "heading" }, slottedNode],
  };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
    value: source,
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

<PageMeta layout="cover" />

# One

---

import Aside from "./Aside.astro";

<PageMeta layout="two-column" />

# Two
`,
    "/project/slides/talk.mdx",
  );

  expect(analysis.pageCount).toBe(2);
  expect(analysis.layouts).toEqual([{ layout: "cover" }, { layout: "two-column" }]);
});

test("remarkDeckupMdxPages leaves non-selected files untouched", () => {
  const tree = { children: [{ type: "heading" }] };
  remarkDeckupMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/other.mdx",
  });
  expect(tree.children).toEqual([{ type: "heading" }]);
});

test("public MDX analysis treats lowercase <layout> as ordinary content, not Deckup metadata", () => {
  const analysis = analyzeMdxDeckSource(`<layout id="two-column" />\n\n# One\n`);
  expect(analysis.pageCount).toBe(1);
  expect(analysis.layouts).toEqual([{ layout: "cover" }]);
});

test("public MDX analysis treats a nested lowercase <layout> as ordinary content, not Deckup metadata", () => {
  const analysis = analyzeMdxDeckSource(`<p>Before <layout id="two-column" /></p>\n`);
  expect(analysis.pageCount).toBe(1);
  expect(analysis.layouts).toEqual([{ layout: "cover" }]);
});

test("public MDX analysis rejects misplaced PageMeta", () => {
  expect(() => countMdxDeckPages(`# One\n\n<PageMeta layout="cover" />\n`)).toThrow(
    /first meaningful direct child/,
  );
});

test("public MDX analysis enforces lexical self-closing PageMeta", () => {
  expect(() => countMdxDeckPages(`<PageMeta layout="cover"></PageMeta>\n\n# One\n`)).toThrow(
    /must be self-closing/,
  );
});

test("public MDX analysis rejects invalid PageMeta layout ids", () => {
  expect(() => countMdxDeckPages(`<PageMeta layout="Cover Slide" />\n\n# One\n`)).toThrow(
    /Invalid Deckup layout id/,
  );
});
