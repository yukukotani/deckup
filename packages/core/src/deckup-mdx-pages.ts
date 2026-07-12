import { Parser } from "acorn";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { resolveDeckupLayout } from "./layout.ts";
import { PAGE_META_MARKER_NAME, resolvePageMetaLayoutAttribute } from "./page-meta.ts";
import type { DeckupDeckMetadata, DeckupDeckRegistry, DeckupResolvedDeck } from "./types.ts";
import { normalizeIdPath } from "./utils.ts";

const pageComponentExport = "@deckup/astro/page";

type MdxJsxAttribute = {
  type?: string;
  name?: string;
  value?: unknown;
};

type MdastPosition = {
  start?: { offset?: number };
  end?: { offset?: number };
};

type MdastNode = {
  type?: string;
  value?: string;
  children?: MdastNode[];
  name?: string;
  attributes?: MdxJsxAttribute[];
  data?: Record<string, unknown>;
  position?: MdastPosition;
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
  value?: string | Uint8Array;
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

function isMdxJsxNodeNamed(node: MdastNode, name: string) {
  return (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === name
  );
}

function isPageMetaNode(node: MdastNode) {
  return isMdxJsxNodeNamed(node, PAGE_META_MARKER_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMdxCommentNode(node: MdastNode) {
  if (node.type !== "mdxFlowExpression") return false;
  const estree = node.data?.estree;
  if (!isRecord(estree)) return false;
  return (
    Array.isArray(estree.body) &&
    estree.body.length === 0 &&
    Array.isArray(estree.comments) &&
    estree.comments.length > 0
  );
}

function collectMdxPageMetaNodes(nodes: MdastNode[]) {
  const markers: MdastNode[] = [];
  function visit(node: MdastNode) {
    if (isPageMetaNode(node)) markers.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  for (const node of nodes) visit(node);
  return markers;
}

function normalizeMdxPageMetaAttributes(node: MdastNode) {
  return (node.attributes ?? []).map((attribute) => ({
    name: attribute.type === "mdxJsxAttribute" ? attribute.name : undefined,
    staticStringValue:
      attribute.type === "mdxJsxAttribute" && typeof attribute.value === "string"
        ? attribute.value
        : undefined,
  }));
}

function getMdxNodeSource(node: MdastNode, source: string | undefined, context: string) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (
    source === undefined ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    (start as number) < 0 ||
    (end as number) < (start as number) ||
    (end as number) > source.length
  ) {
    throw new Error(`Cannot validate PageMeta declaration in ${context} without its source span.`);
  }
  return source.slice(start as number, end as number);
}

function resolveMdxPage(
  page: MdastNode[],
  pageIndex: number,
  filePath: string,
  source?: string,
): DeckupMdxPage {
  const context = `${filePath} page ${pageIndex + 1}`;
  const pageMetaNodes = collectMdxPageMetaNodes(page);
  if (pageMetaNodes.length > 1) {
    throw new Error(`Deckup deck contains multiple PageMeta declarations in ${context}.`);
  }

  const pageMeta = pageMetaNodes[0];
  if (pageMeta && (pageMeta.children ?? []).length > 0) {
    throw new Error(`PageMeta declaration in ${context} must not have children.`);
  }
  const firstMeaningfulChild = page.find((child) => !isMdxCommentNode(child));
  if (pageMeta && pageMeta !== firstMeaningfulChild) {
    throw new Error(
      `PageMeta declaration in ${context} must be the first meaningful direct child.`,
    );
  }

  let explicitLayout: string | undefined;
  if (pageMeta) {
    if (!/\/>\s*$/.test(getMdxNodeSource(pageMeta, source, context))) {
      throw new Error(`PageMeta declaration in ${context} must be self-closing.`);
    }
    explicitLayout = resolvePageMetaLayoutAttribute(
      normalizeMdxPageMetaAttributes(pageMeta),
      context,
    );
  }

  return {
    children: page.filter((child) => child !== pageMeta),
    layout: resolveDeckupLayout(explicitLayout, pageIndex, context),
  };
}

function resolveMdxPages(children: MdastNode[], filePath: string, source?: string) {
  return splitMdxChildrenIntoPages(children).map((page, pageIndex) =>
    resolveMdxPage(page, pageIndex, filePath, source),
  );
}

function getVFileSource(file: VFileLike) {
  if (typeof file.value === "string") return file.value;
  return file.value instanceof Uint8Array ? new TextDecoder().decode(file.value) : undefined;
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
    const pages = resolveMdxPages(renderableNodes, deck.filePath, getVFileSource(file));
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
  return unified().use(remarkParse).use(remarkMdx).parse(source) as MdastRoot;
}

export function analyzeMdxDeckSource(source: string, filePath = "MDX deck"): DeckupMdxDeckAnalysis {
  const bodySource = stripMdxFrontmatter(source);
  const renderableNodes = getRenderableMdxNodes(parseMdxBody(bodySource).children);
  const pages = resolveMdxPages(renderableNodes, filePath, bodySource);
  return {
    pageCount: pages.length,
    layouts: pages.map((page) => ({ layout: page.layout })),
    metadata: analyzeMdxDeckMetadata(source, filePath),
  };
}

export function countMdxDeckPages(source: string) {
  return analyzeMdxDeckSource(source).pageCount;
}
