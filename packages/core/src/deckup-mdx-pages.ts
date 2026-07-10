import { Parser } from "acorn";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { resolveDeckupLayout } from "./layout.ts";
import type { DeckupDeckMetadata, DeckupDeckRegistry, DeckupResolvedDeck } from "./types.ts";
import { normalizeIdPath } from "./utils.ts";

const pageComponentExport = "@deckup/astro/page";

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

type DeckupMdxPage = {
  children: MdastNode[];
  layout: string;
};

type DeckupMdxDeckAnalysis = {
  pageCount: number;
  layouts: Array<{ layout: string }>;
  metadata: DeckupDeckMetadata;
};

type VFileLike = {
  path?: string;
  history?: string[];
};

export interface DeckupMdxPagesOptions {
  deckFile?: string;
  registry?: DeckupDeckRegistry;
  themeForDeck?: (deck: DeckupResolvedDeck) => string | undefined;
  pageComponentForDeck?: (deck: DeckupResolvedDeck) => string | undefined;
}

function isSelectedFile(file: VFileLike, deckFile: string) {
  const selected = normalizeIdPath(deckFile);
  const candidates = [file.path, ...(file.history ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeIdPath);
  return candidates.some(
    (candidate) => candidate === selected || candidate.endsWith(`/${selected}`),
  );
}

function resolveSelectedMdxDeck(
  file: VFileLike,
  options: DeckupMdxPagesOptions,
): DeckupResolvedDeck | undefined {
  const registryDeck = options.registry?.matchMdxFile(file);
  if (registryDeck) return registryDeck;
  if (options.deckFile && isSelectedFile(file, options.deckFile)) {
    return {
      filePath: options.deckFile,
      projectRelativePath: normalizeIdPath(options.deckFile).replace(/^\/+/, ""),
      format: "mdx",
    };
  }
  return undefined;
}

function createPageImportNode(componentExport = pageComponentExport): MdastNode {
  const value = `import Page from ${JSON.stringify(componentExport)};`;
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

function resolveMdxPage(page: MdastNode[], pageIndex: number, filePath: string): DeckupMdxPage {
  const context = `${filePath} page ${pageIndex + 1}`;
  const layoutNodes = page.filter(isLayoutNode);
  if (layoutNodes.length > 1) {
    throw new Error(`MDX deck contains multiple layout declarations in ${context}.`);
  }

  const explicitLayout = layoutNodes[0] ? getLayoutIdAttribute(layoutNodes[0], context) : undefined;
  return {
    children: page.filter((child) => !isLayoutNode(child)),
    layout: resolveDeckupLayout(explicitLayout, pageIndex, context),
  };
}

function resolveMdxPages(children: MdastNode[], filePath: string) {
  return splitMdxChildrenIntoPages(children).map((page, pageIndex) =>
    resolveMdxPage(page, pageIndex, filePath),
  );
}

function getRenderableMdxNodes(children: MdastRoot["children"]) {
  return children.filter((child) => child.type !== "mdxjsEsm");
}

function createPageNode(page: DeckupMdxPage, themeName?: string): MdastNode {
  const attributes: MdxJsxAttribute[] = [
    { type: "mdxJsxAttribute", name: "layout", value: page.layout },
  ];
  if (themeName) {
    attributes.push({ type: "mdxJsxAttribute", name: "theme", value: themeName });
  }

  return {
    type: "mdxJsxFlowElement",
    name: "Page",
    attributes,
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

export function remarkDeckupMdxPages(options: DeckupMdxPagesOptions = {}) {
  return function transformDeckupMdxPages(tree: MdastRoot, file: VFileLike) {
    const deck = resolveSelectedMdxDeck(file, options);
    if (!deck) return;

    const themeName = options.themeForDeck?.(deck);
    const pageComponent = options.pageComponentForDeck?.(deck);
    const esmNodes = tree.children.filter((child) => child.type === "mdxjsEsm");
    const renderableNodes = getRenderableMdxNodes(tree.children);
    const pages = resolveMdxPages(renderableNodes, deck.filePath);
    tree.children = [
      createPageImportNode(pageComponent),
      ...esmNodes,
      ...pages.map((page) => createPageNode(page, themeName)),
    ];
  };
}

function emptyDeckMetadata(): DeckupDeckMetadata {
  return {};
}

function extractMdxFrontmatterBlock(source: string) {
  if (!source.startsWith("---")) return undefined;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  return match?.[1];
}

function parseYamlStringScalar(value: string, context: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${context} must be a non-empty string.`);
  }

  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"')) throw new TypeError(`${context} must be a static string.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw new TypeError(`${context} must be a static string.`, { cause: error });
    }
    if (typeof parsed !== "string" || parsed.trim().length === 0) {
      throw new TypeError(`${context} must be a non-empty string.`);
    }
    return parsed.trim();
  }

  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'")) throw new TypeError(`${context} must be a static string.`);
    const parsed = trimmed.slice(1, -1).replaceAll("''", "'");
    if (parsed.trim().length === 0) throw new TypeError(`${context} must be a non-empty string.`);
    return parsed.trim();
  }

  if (
    /^(?:true|false|null|~)$/i.test(trimmed) ||
    /^[-+]?\d+(?:\.\d+)?$/.test(trimmed) ||
    /^[{[>|]/.test(trimmed)
  ) {
    throw new TypeError(`${context} must be a static string.`);
  }

  return trimmed;
}

export function analyzeMdxDeckMetadata(source: string, filePath = "MDX deck"): DeckupDeckMetadata {
  const frontmatter = extractMdxFrontmatterBlock(source);
  if (frontmatter === undefined) return emptyDeckMetadata();

  let theme: string | undefined;
  for (const [lineIndex, line] of frontmatter.split(/\r?\n/).entries()) {
    const match = /^theme\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    if (theme !== undefined) {
      throw new Error(`Duplicate Deckup theme metadata in ${filePath}.`);
    }
    theme = parseYamlStringScalar(
      match[1],
      `MDX deck theme metadata in ${filePath} line ${lineIndex + 1}`,
    );
  }

  return theme === undefined ? emptyDeckMetadata() : { theme };
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

export function analyzeMdxDeckSource(source: string, filePath = "MDX deck"): DeckupMdxDeckAnalysis {
  const renderableNodes = getRenderableMdxNodes(parseMdxBody(source).children);
  const pages = resolveMdxPages(renderableNodes, filePath);
  return {
    pageCount: pages.length,
    layouts: pages.map((page) => ({ layout: page.layout })),
    metadata: analyzeMdxDeckMetadata(source, filePath),
  };
}

export function countMdxDeckPages(source: string) {
  return analyzeMdxDeckSource(source).pageCount;
}
