import { Parser } from "acorn";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { resolveSlidaLayout } from "./layout.ts";

const pageComponentExport = "@slida/cli/page";

type MdxJsxAttribute = {
  type?: string;
  name?: string;
  value?: unknown;
};

type MdastNode = {
  type?: string;
  value?: string;
  children?: MdastNode[];
  name?: string;
  attributes?: MdxJsxAttribute[];
  data?: Record<string, unknown>;
};

type MdastRoot = {
  children: MdastNode[];
};

type SlidaMdxPage = {
  children: MdastNode[];
  layout: string;
};

type VFileLike = {
  path?: string;
  history?: string[];
};

export interface SlidaMdxPagesOptions {
  deckFile: string;
}

function normalizePath(path: string) {
  return path.split(/[\\/]+/).join("/");
}

function isSelectedFile(file: VFileLike, deckFile: string) {
  const selected = normalizePath(deckFile);
  const candidates = [file.path, ...(file.history ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map(normalizePath);
  return candidates.some(
    (candidate) => candidate === selected || candidate.endsWith(`/${selected}`),
  );
}

function createPageImportNode(): MdastNode {
  const value = `import Page from ${JSON.stringify(pageComponentExport)};`;
  return {
    type: "mdxjsEsm",
    value,
    data: {
      estree: Parser.parse(value, { ecmaVersion: "latest", sourceType: "module" }),
    },
  };
}

function isLayoutNode(node: MdastNode) {
  return node.type === "mdxJsxFlowElement" && node.name === "layout";
}

function getLayoutIdAttribute(node: MdastNode, context: string) {
  const idAttribute = node.attributes?.find((attribute) => attribute.name === "id");
  if (!idAttribute || idAttribute.value === null || idAttribute.value === undefined) {
    throw new Error(`MDX layout declaration in ${context} must include an id attribute.`);
  }

  if (typeof idAttribute.value !== "string") {
    throw new TypeError(`MDX layout declaration in ${context} must use a string id attribute.`);
  }

  return idAttribute.value;
}

function resolveMdxPage(page: MdastNode[], pageIndex: number, filePath: string): SlidaMdxPage {
  const context = `${filePath} page ${pageIndex + 1}`;
  const layoutNodes = page.filter(isLayoutNode);
  if (layoutNodes.length > 1) {
    throw new Error(`MDX deck contains multiple layout declarations in ${context}.`);
  }

  const explicitLayout = layoutNodes[0] ? getLayoutIdAttribute(layoutNodes[0], context) : undefined;
  return {
    children: page.filter((child) => !isLayoutNode(child)),
    layout: resolveSlidaLayout(explicitLayout, pageIndex, context),
  };
}

function resolveMdxPages(children: MdastNode[], filePath: string) {
  return splitMdxChildrenIntoPages(children).map((page, pageIndex) =>
    resolveMdxPage(page, pageIndex, filePath),
  );
}

function createPageNode(page: SlidaMdxPage): MdastNode {
  return {
    type: "mdxJsxFlowElement",
    name: "Page",
    attributes: [{ type: "mdxJsxAttribute", name: "layout", value: page.layout }],
    children: page.children,
  };
}

export function splitMdxChildrenIntoPages(children: MdastNode[]) {
  const pages: MdastNode[][] = [[]];

  for (const child of children) {
    if (child.type === "thematicBreak") {
      pages.push([]);
    } else {
      pages.at(-1)?.push(child);
    }
  }

  const emptyPageIndex = pages.findIndex((page) => page.length === 0);
  if (emptyPageIndex >= 0) {
    throw new Error(
      `MDX deck contains an empty page at position ${emptyPageIndex + 1}. Remove adjacent dividers or add content.`,
    );
  }

  return pages;
}

export function remarkSlidaMdxPages(options: SlidaMdxPagesOptions) {
  return function transformSlidaMdxPages(tree: MdastRoot, file: VFileLike) {
    if (!isSelectedFile(file, options.deckFile)) {
      return;
    }

    const esmNodes = tree.children.filter((child) => child.type === "mdxjsEsm");
    const renderableNodes = tree.children.filter((child) => child.type !== "mdxjsEsm");
    const pages = resolveMdxPages(renderableNodes, options.deckFile);
    tree.children = [createPageImportNode(), ...esmNodes, ...pages.map(createPageNode)];
  };
}

export function stripMdxFrontmatter(source: string) {
  if (!source.startsWith("---")) {
    return source;
  }

  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  return match ? source.slice(match[0].length) : source;
}

function parseMdxBody(source: string): MdastRoot {
  return unified().use(remarkParse).use(remarkMdx).parse(stripMdxFrontmatter(source)) as MdastRoot;
}

export function countMdxDeckPages(source: string) {
  return resolveMdxPages(parseMdxBody(source).children, "MDX deck").length;
}
