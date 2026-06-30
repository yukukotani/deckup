import { Parser } from "acorn";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

const pageComponentExport = "@slida/cli/page";

type MdastNode = {
  type?: string;
  value?: string;
  children?: MdastNode[];
  name?: string;
  attributes?: Array<Record<string, unknown>>;
  data?: Record<string, unknown>;
};

type MdastRoot = {
  children: MdastNode[];
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

function createPageNode(children: MdastNode[]): MdastNode {
  return {
    type: "mdxJsxFlowElement",
    name: "Page",
    attributes: [],
    children,
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
    const pages = splitMdxChildrenIntoPages(renderableNodes);
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
  return splitMdxChildrenIntoPages(parseMdxBody(source).children).length;
}
