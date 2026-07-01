import { expect, test } from "vite-plus/test";

import {
  analyzeMdxDeckSource,
  countMdxDeckPages,
  remarkSlidaMdxPages,
  splitMdxChildrenIntoPages,
  stripMdxFrontmatter,
} from "../src/slida-mdx-pages.ts";

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

test("remarkSlidaMdxPages wraps only the selected file in Page nodes", () => {
  const tree = {
    children: [{ type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(tree.children[0]).toMatchObject({ type: "mdxjsEsm" });
  expect(tree.children[1]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
  expect(tree.children[2]).toMatchObject({ type: "mdxJsxFlowElement", name: "Page" });
});

test("remarkSlidaMdxPages adds default layout attributes", () => {
  const tree = {
    children: [{ type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("cover");
  expect(getPageLayout(tree.children[2])).toBe("default");
});

test("remarkSlidaMdxPages moves layout declarations to Page attributes", () => {
  const layoutNode = {
    type: "mdxJsxFlowElement",
    name: "layout",
    attributes: [{ type: "mdxJsxAttribute", name: "id", value: "section-intro" }],
    children: [],
  };
  const tree = {
    children: [layoutNode, { type: "heading" }, { type: "thematicBreak" }, { type: "paragraph" }],
  };
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("section-intro");
  expect(tree.children[1]).toMatchObject({ children: [{ type: "heading" }] });
  expect(tree.children[2]).toMatchObject({ children: [{ type: "paragraph" }] });
});

test("remarkSlidaMdxPages preserves slot attributes on generated Page children", () => {
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
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("two-column");
  expect(getPageChildren(tree.children[1])).toEqual([{ type: "heading" }, slottedNode]);
});

test("remarkSlidaMdxPages keeps author-side slot elements as content", () => {
  const authorSlotNode = {
    type: "mdxJsxFlowElement",
    name: "slot",
    attributes: [{ type: "mdxJsxAttribute", name: "name", value: "left" }],
    children: [{ type: "paragraph" }],
  };
  const tree = { children: [authorSlotNode, { type: "heading" }] };
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
    path: "/project/slides/talk.mdx",
  });

  expect(getPageLayout(tree.children[1])).toBe("cover");
  expect(getPageChildren(tree.children[1])).toEqual([authorSlotNode, { type: "heading" }]);
});

test("remarkSlidaMdxPages keeps user MDX ESM outside generated Page nodes", () => {
  const tree = {
    children: [
      { type: "mdxjsEsm", value: "import Chart from './Chart.astro';" },
      { type: "heading" },
    ],
  };
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
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

test("remarkSlidaMdxPages leaves non-selected files untouched", () => {
  const tree = { children: [{ type: "heading" }] };
  remarkSlidaMdxPages({ deckFile: "/project/slides/talk.mdx" })(tree, {
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
  ).toThrow(/Invalid Slida layout id/);
});

test("countMdxDeckPages rejects invalid layout ids", () => {
  expect(() =>
    countMdxDeckPages(`<layout id="Cover Slide" />

# One
`),
  ).toThrow(/Invalid Slida layout id/);
});
