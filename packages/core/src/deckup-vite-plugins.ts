import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { parse } from "@astrojs/compiler-rs";
import { bundledLanguages, createHighlighter } from "shiki";
import type { Plugin } from "vite-plus";

import {
  findAstroRoot,
  getAttribute,
  isJsxElementNamed,
  type AstroImportDeclaration,
  type AstroNode,
  type AstroRoot,
} from "./astro-ast.ts";
import { resolveDeckupLayout } from "./layout.ts";
import { createRuntimePageSource } from "./runtime-page.ts";
import { analyzeMdxDeckSource } from "./deckup-mdx-pages.ts";
import {
  VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
  createThemeLayoutsModuleId,
  createThemeLayoutDiscoveryCache,
  createGeneratedPageComponentSource,
  createGeneratedThemePageComponentSource,
  parseThemeLayoutsModuleId,
  toViteFsImportPath,
} from "./theme-layouts.ts";
import type {
  RawAstroCodeHighlightOptions,
  DeckupDeckMetadata,
  DeckupDeckRegistry,
  DeckupResolvedDeck,
  DeckupResolvedDeckRoute,
  DeckupResolvedTheme,
} from "./types.ts";
import { normalizeIdPath, uniqueStrings } from "./utils.ts";

export const VIRTUAL_DECKUP_DECK_ID = "virtual:deckup/deck";

function resolvedVirtualId(id: string) {
  return `\0${id}`;
}

const pageComponentExport = "@deckup/astro/page";
// Coupling point to Astro's compiled output. The Astro compiler emits
// `$$renderComponent($$result, "Page", Page, { ...props }, ...)` for each
// deck Page. If an Astro upgrade changes this shape, the integration tests
// in tests/astro.test.ts (buildDeck + data-deckup-layout assertions) and the
// characterization tests in tests/deckup-vite-plugins.test.ts fail first.
// Keep this tolerant to whitespace-only formatting changes.
const compiledPageRenderPattern = /\$\$renderComponent\(\s*\$\$result\s*,\s*"Page"\s*,\s*Page\s*,/g;
const transformedSourceMarker = "// data-deckup-source-transformed";
const utf8Encoder = new TextEncoder();

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

type AstroSourceEdit = { start: number; end: number; value: string };
type AstroPageLayout = { layout: string };
type AstroDeckAnalysis = {
  pageCount: number;
  edits: AstroSourceEdit[];
  layouts: AstroPageLayout[];
  pages: AstroNode[];
  metadata: DeckupDeckMetadata;
  pageImportSpan: { start: number; end: number };
};
type StaticAstroCodeBlock = {
  code: string;
  language: string;
  span: { start: number; end: number };
};
export interface DeckupVitePluginOptions {
  generatedPageFilePath?: string;
  generatedPageFilePathForTheme?: (themeName: string) => string | undefined;
  codeHighlight?: RawAstroCodeHighlightOptions;
  deckLayoutModuleId?: string;
}
type DiscoverThemeLayouts = ReturnType<typeof createThemeLayoutDiscoveryCache>;
type GeneratedPageMemo = Map<string, string>;
export type DeckupThemeForDeck = (deck: DeckupResolvedDeck) => DeckupResolvedTheme | undefined;
type DeckupThemeLookup = DeckupResolvedTheme | DeckupThemeForDeck | undefined;

const shikiHighlighters = new Map<string, Promise<ShikiHighlighter>>();

function getShikiHighlighter(theme: string) {
  let highlighter = shikiHighlighters.get(theme);
  if (!highlighter) {
    highlighter = createHighlighter({ themes: [theme], langs: ["text"] });
    shikiHighlighters.set(theme, highlighter);
  }
  return highlighter;
}

function isBundledShikiLanguage(language: string) {
  return language in bundledLanguages;
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function appendClassName(classValue: string, className: string) {
  const classes = classValue.split(/\s+/).filter(Boolean);
  return classes.includes(className) ? classValue : [className, ...classes].join(" ");
}

function normalizeHighlightedCodeHtml(html: string, language: string) {
  return html.replace(/^<pre\b([^>]*)>/, (_match, attributes: string) => {
    let nextAttributes = attributes;
    if (/\sclass="([^"]*)"/.test(nextAttributes)) {
      nextAttributes = nextAttributes.replace(
        /\sclass="([^"]*)"/,
        (_classMatch, classValue: string) =>
          ` class="${appendClassName(classValue, "astro-code")}"`,
      );
    } else {
      nextAttributes = ` class="astro-code"${nextAttributes}`;
    }
    if (!/\sdata-language=/.test(nextAttributes)) {
      nextAttributes += ` data-language="${escapeAttribute(language)}"`;
    }
    return `<pre${nextAttributes}>`;
  });
}

async function highlightStaticAstroCodeBlock(
  highlighter: ShikiHighlighter,
  block: StaticAstroCodeBlock,
  theme: string,
) {
  const language = isBundledShikiLanguage(block.language) ? block.language : "text";
  if (language !== "text") {
    await highlighter.loadLanguage(language as never);
  }
  return normalizeHighlightedCodeHtml(
    highlighter.codeToHtml(block.code, { lang: language as never, theme }),
    block.language,
  );
}

async function createAstroCodeHighlightEdits(
  source: string,
  pages: AstroNode[],
  filePath: string,
  codeHighlight: RawAstroCodeHighlightOptions | undefined,
): Promise<AstroSourceEdit[]> {
  if (!codeHighlight?.enabled) return [];
  const blocks = collectStaticAstroCodeBlocks(source, pages, filePath);
  if (blocks.length === 0) return [];

  const highlighter = await getShikiHighlighter(codeHighlight.theme);
  return Promise.all(
    blocks.map(async (block) => ({
      ...block.span,
      value: await highlightStaticAstroCodeBlock(highlighter, block, codeHighlight.theme),
    })),
  );
}

function isWhitespace(node: AstroNode) {
  return node.type === "JSXText" && (node.value ?? "").trim().length === 0;
}

function isTopLevelPage(node: AstroNode) {
  return isJsxElementNamed(node, "Page");
}

function isLayoutDeclaration(node: AstroNode) {
  return isJsxElementNamed(node, "layout");
}

function getLiteralStringAttribute(node: AstroNode, name: string) {
  const attribute = getAttribute(node, name);
  if (attribute?.value?.type !== "Literal" || typeof attribute.value.value !== "string") {
    return undefined;
  }
  return attribute.value.value;
}

function getCodeLanguage(className: string) {
  return /(?:^|\s)language-([^\s]+)/.exec(className)?.[1];
}

function getMeaningfulChildren(node: AstroNode) {
  return (node.children ?? []).filter((child) => !isWhitespace(child));
}

function hasAttributes(node: AstroNode) {
  return (node.openingElement?.attributes?.length ?? 0) > 0;
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return (
      (
        {
          amp: "&",
          apos: "'",
          gt: ">",
          lt: "<",
          quot: '"',
        } as const
      )[body.toLowerCase() as "amp" | "apos" | "gt" | "lt" | "quot"] ?? entity
    );
  });
}

function getTextOnlyContent(
  source: string,
  toSourceIndex: ReturnType<typeof createSourceIndexConverter>,
  node: AstroNode,
  context: string,
) {
  const children = node.children ?? [];
  if (children.some((child) => child.type !== "JSXText")) return undefined;
  const openingEnd = node.openingElement?.end;
  if (typeof openingEnd !== "number" || typeof node.end !== "number") {
    return decodeHtmlEntities(children.map((child) => child.value ?? "").join(""));
  }
  const start = toSourceIndex(openingEnd, `${context} code opening tag end`);
  const end = toSourceIndex(node.end, `${context} code end`);
  const rawCodeWithClosingTag = source.slice(start, end);
  const closingTagIndex = rawCodeWithClosingTag.toLowerCase().lastIndexOf("</code>");
  if (closingTagIndex < 0) return undefined;
  return decodeHtmlEntities(rawCodeWithClosingTag.slice(0, closingTagIndex));
}

function hasAttribute(node: AstroNode, name: string) {
  return getAttribute(node, name) !== undefined;
}

function findDefaultPageImport(ast: AstroRoot): AstroImportDeclaration | undefined {
  return ast.frontmatter?.program?.body?.find((node) => {
    if (node.type !== "ImportDeclaration" || node.source?.value !== pageComponentExport) {
      return false;
    }
    return node.specifiers?.some(
      (specifier) =>
        specifier.type === "ImportDefaultSpecifier" && specifier.local?.name === "Page",
    );
  }) as AstroImportDeclaration | undefined;
}

function sanitizeStaticCodeTextForAstroParse(source: string) {
  return source.replace(
    /(<pre\b[^>]*>\s*<code\b[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi,
    (_match, opening: string, code: string, closing: string) =>
      `${opening}${code.replace(/[{}]/g, " ")}${closing}`,
  );
}

function escapeRawCodeTextBraces(source: string) {
  return source.replace(
    /(<pre\b[^>]*>\s*<code\b[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi,
    (_match, opening: string, code: string, closing: string) =>
      `${opening}${code.replaceAll("{", "&#123;").replaceAll("}", "&#125;")}${closing}`,
  );
}

function markTransformedAstroSource(source: string) {
  return source.includes(transformedSourceMarker)
    ? source
    : source.replace(/^---\n/, `---\n${transformedSourceMarker}\n`);
}

function parseAstroDeck(source: string, filePath: string) {
  const result = parse(sanitizeStaticCodeTextForAstroParse(source));
  if (result.diagnostics.length > 0) {
    throw new Error(
      `Failed to parse Astro deck ${filePath}: ${result.diagnostics[0]?.text ?? "unknown parse error"}`,
    );
  }
  const parsedAst = typeof result.ast === "string" ? JSON.parse(result.ast) : result.ast;
  const ast = findAstroRoot(parsedAst);
  if (!ast) throw new Error(`Failed to parse Astro deck ${filePath}: AstroRoot not found`);
  return ast;
}

// Exported for tests only; not part of the public package surface (index.ts).
export function createSourceIndexConverter(source: string) {
  // byteToIndex[b] = JS string index for UTF-8 byte offset b (boundaries only).
  const byteToIndex = new Map<number, number>();
  let bytes = 0;
  for (let index = 0; index < source.length; ) {
    byteToIndex.set(bytes, index);
    const codePoint = source.codePointAt(index) as number;
    const character = String.fromCodePoint(codePoint);
    bytes += utf8Encoder.encode(character).length;
    index += character.length;
  }
  byteToIndex.set(bytes, source.length);

  return function toSourceIndex(byteOffset: number, context: string) {
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      throw new Error(`Failed to transform Astro deck: invalid source offset for ${context}.`);
    }
    const index = byteToIndex.get(byteOffset);
    if (index === undefined) {
      throw new Error(
        `Failed to transform Astro deck: source offset ${byteOffset} is not a UTF-8 boundary for ${context}.`,
      );
    }
    return index;
  };
}

function getRequiredSpan(
  toSourceIndex: ReturnType<typeof createSourceIndexConverter>,
  node: { start?: number; end?: number },
  context: string,
) {
  if (typeof node.start !== "number" || typeof node.end !== "number") {
    throw new Error(`Failed to transform Astro deck: missing source span for ${context}.`);
  }
  return {
    start: toSourceIndex(node.start, `${context} start`),
    end: toSourceIndex(node.end, `${context} end`),
  };
}

function getOptionalSpan(
  toSourceIndex: ReturnType<typeof createSourceIndexConverter>,
  node: AstroNode,
  context: string,
) {
  if (typeof node.start !== "number" || typeof node.end !== "number") return undefined;
  try {
    return {
      start: toSourceIndex(node.start, `${context} start`),
      end: toSourceIndex(node.end, `${context} end`),
    };
  } catch {
    return undefined;
  }
}

function resolveStaticAstroCodeBlock(
  source: string,
  toSourceIndex: ReturnType<typeof createSourceIndexConverter>,
  node: AstroNode,
  context: string,
): StaticAstroCodeBlock | undefined {
  if (!isJsxElementNamed(node, "pre")) return undefined;
  if (hasAttributes(node)) return undefined;

  const children = getMeaningfulChildren(node);
  if (children.length !== 1) return undefined;

  const codeNode = children[0];
  if (!isJsxElementNamed(codeNode, "code")) return undefined;

  const className = getLiteralStringAttribute(codeNode, "class");
  if (!className) return undefined;

  const language = getCodeLanguage(className);
  if (!language) return undefined;

  const code = getTextOnlyContent(source, toSourceIndex, codeNode, context);
  if (code === undefined) return undefined;

  const span = getOptionalSpan(toSourceIndex, node, context);
  if (!span) return undefined;
  if (source.slice(span.start, span.end).trim().length === 0) return undefined;

  return { code, language, span };
}

function collectStaticAstroCodeBlocksFromNode(
  source: string,
  toSourceIndex: ReturnType<typeof createSourceIndexConverter>,
  node: AstroNode,
  context: string,
): StaticAstroCodeBlock[] {
  const block = resolveStaticAstroCodeBlock(source, toSourceIndex, node, context);
  if (block) return [block];
  return (node.children ?? []).flatMap((child, index) =>
    collectStaticAstroCodeBlocksFromNode(
      source,
      toSourceIndex,
      child,
      `${context} child ${index + 1}`,
    ),
  );
}

function collectStaticAstroCodeBlocks(source: string, pages: AstroNode[], filePath: string) {
  const toSourceIndex = createSourceIndexConverter(source);
  return pages.flatMap((page, pageIndex) =>
    collectStaticAstroCodeBlocksFromNode(
      source,
      toSourceIndex,
      page,
      `${filePath} page ${pageIndex + 1}`,
    ),
  );
}

function getPageAttributeInsertionOffset(
  source: string,
  toSourceIndex: ReturnType<typeof createSourceIndexConverter>,
  page: AstroNode,
  context: string,
) {
  const end = page.openingElement?.end;
  if (typeof end !== "number") {
    throw new Error(`Failed to transform Astro deck: missing opening tag span for ${context}.`);
  }
  const endIndex = toSourceIndex(end, `${context} opening tag end`);
  return source[endIndex - 2] === "/" ? endIndex - 2 : endIndex - 1;
}

function getLayoutIdAttribute(node: AstroNode, context: string) {
  const idAttribute = getAttribute(node, "id");
  if (!idAttribute || idAttribute.value === null || idAttribute.value === undefined) {
    throw new Error(`Astro layout declaration in ${context} must include an id attribute.`);
  }
  if (idAttribute.value.type !== "Literal" || typeof idAttribute.value.value !== "string") {
    throw new TypeError(`Astro layout declaration in ${context} must use a string id attribute.`);
  }
  return idAttribute.value.value;
}

function resolveAstroPageLayout(page: AstroNode, pageIndex: number, filePath: string) {
  const context = `${filePath} page ${pageIndex + 1}`;
  if (hasAttribute(page, "layout")) {
    throw new Error(
      `Astro Page layout in ${context} must be declared with a child <layout id="..." /> element.`,
    );
  }
  const layoutNodes = (page.children ?? []).filter(isLayoutDeclaration);
  if (layoutNodes.length > 1) {
    throw new Error(`Astro deck contains multiple layout declarations in ${context}.`);
  }
  const layoutNode = layoutNodes[0];
  if (layoutNode) {
    const hasContent = (layoutNode.children ?? []).some((child) => !isWhitespace(child));
    if (!layoutNode.openingElement?.selfClosing || hasContent) {
      throw new Error(`Astro layout declaration in ${context} must be self-closing.`);
    }
  }
  const explicitLayout = layoutNode ? getLayoutIdAttribute(layoutNode, context) : undefined;
  return { layout: resolveDeckupLayout(explicitLayout, pageIndex, context), layoutNodes };
}

function analyzeAstroLayouts(
  source: string,
  pages: AstroNode[],
  filePath: string,
  themeName?: string,
) {
  const edits: AstroSourceEdit[] = [];
  const layouts: AstroPageLayout[] = [];
  const toSourceIndex = createSourceIndexConverter(source);
  for (const [pageIndex, page] of pages.entries()) {
    const context = `${filePath} page ${pageIndex + 1}`;
    const { layout, layoutNodes } = resolveAstroPageLayout(page, pageIndex, filePath);
    layouts.push({ layout });
    const insertAt = getPageAttributeInsertionOffset(source, toSourceIndex, page, context);
    edits.push({
      start: insertAt,
      end: insertAt,
      value: ` layout=${JSON.stringify(layout)}${themeName ? ` theme=${JSON.stringify(themeName)}` : ""}`,
    });
    for (const layoutNode of layoutNodes) {
      edits.push({ ...getRequiredSpan(toSourceIndex, layoutNode, context), value: "" });
    }
  }
  return { edits, layouts };
}

function applySourceEdits(source: string, edits: AstroSourceEdit[]) {
  return [...edits]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((code, edit) => code.slice(0, edit.start) + edit.value + code.slice(edit.end), source);
}

export function analyzeAstroDeckMetadata(
  source: string,
  filePath = "Astro deck",
): DeckupDeckMetadata {
  return extractStaticAstroDeckMetadata(parseAstroDeck(source, filePath), filePath);
}

function extractStaticAstroDeckMetadata(ast: AstroRoot, filePath: string): DeckupDeckMetadata {
  let theme: string | undefined;
  for (const node of ast.frontmatter?.program?.body ?? []) {
    if (node.type !== "VariableDeclaration") continue;
    for (const declaration of node.declarations ?? []) {
      if (declaration.id?.type !== "Identifier" || declaration.id.name !== "theme") continue;
      if (theme !== undefined) {
        throw new Error(`Duplicate Deckup theme metadata in ${filePath}.`);
      }
      if (node.kind !== "const") {
        throw new TypeError(
          `Astro deck theme metadata in ${filePath} must use const theme = "...".`,
        );
      }
      if (declaration.init?.type !== "Literal" || typeof declaration.init.value !== "string") {
        throw new TypeError(
          `Astro deck theme metadata in ${filePath} must be a static string literal.`,
        );
      }
      const themeName = declaration.init.value.trim();
      if (themeName.length === 0) {
        throw new TypeError(`Astro deck theme metadata in ${filePath} must be a non-empty string.`);
      }
      theme = themeName;
    }
  }
  return theme === undefined ? {} : { theme };
}

function analyzeAstroDeckSource(
  source: string,
  filePath: string,
  themeName?: string,
): AstroDeckAnalysis {
  const ast = parseAstroDeck(source, filePath);
  const metadata = extractStaticAstroDeckMetadata(ast, filePath);
  const pageImport = findDefaultPageImport(ast);
  if (!pageImport) {
    throw new Error(
      `Astro deck must import Page from ${JSON.stringify(pageComponentExport)}: ${filePath}`,
    );
  }
  const invalidNode = (ast.body ?? []).find((node) => !isWhitespace(node) && !isTopLevelPage(node));
  if (invalidNode) {
    throw new Error(`Astro deck top-level content must be <Page> components only: ${filePath}`);
  }
  const pages = (ast.body ?? []).filter(isTopLevelPage);
  if (pages.length === 0) {
    throw new Error(`Astro deck must contain at least one top-level <Page>: ${filePath}`);
  }
  const toSourceIndex = createSourceIndexConverter(source);
  const pageImportSpan = getRequiredSpan(toSourceIndex, pageImport.source ?? {}, filePath);
  const { edits, layouts } = analyzeAstroLayouts(source, pages, filePath, themeName);
  return { pageCount: pages.length, edits, layouts, pages, metadata, pageImportSpan };
}

export function countAstroDeckPages(source: string, filePath = "<deck>") {
  const ast = parseAstroDeck(source, filePath);
  return (ast.body ?? []).filter(isTopLevelPage).length;
}

// Exported for tests only; not part of the public package surface (index.ts).
export function collectStaticAstroCodeBlocksForTests(source: string, filePath = "<deck>") {
  const ast = parseAstroDeck(source, filePath);
  const pages = (ast.body ?? []).filter(isTopLevelPage);
  return collectStaticAstroCodeBlocks(source, pages, filePath);
}

export function validateAstroDeckSource(source: string, filePath = "<deck>") {
  return analyzeAstroDeckSource(source, filePath).pageCount;
}

// Exported for tests only; not part of the public package surface (index.ts).
export function analyzeAstroDeckSourceForTests(source: string, filePath = "<deck>") {
  const analysis = analyzeAstroDeckSource(source, filePath);
  return {
    pageCount: analysis.pageCount,
    layouts: analysis.layouts,
    metadata: analysis.metadata,
  };
}

export function transformAstroDeckSource(source: string, filePath = "<deck>", themeName?: string) {
  return applySourceEdits(source, analyzeAstroDeckSource(source, filePath, themeName).edits);
}

// Exported for tests only; not part of the public package surface (index.ts).
export async function transformAstroDeckSourceWithCodeHighlighting(
  source: string,
  filePath = "<deck>",
  codeHighlight: RawAstroCodeHighlightOptions = { enabled: true, theme: "github-dark" },
  themeName?: string,
) {
  const analysis = analyzeAstroDeckSource(source, filePath, themeName);
  const codeEdits = await createAstroCodeHighlightEdits(
    source,
    analysis.pages,
    filePath,
    codeHighlight,
  );
  return escapeRawCodeTextBraces(applySourceEdits(source, [...analysis.edits, ...codeEdits]));
}

async function transformAstroDeckSourceForBuild(
  source: string,
  filePath: string,
  codeHighlight: RawAstroCodeHighlightOptions | undefined,
  themeName?: string,
  pageComponentImport?: string,
) {
  const analysis = analyzeAstroDeckSource(source, filePath, themeName);
  const codeEdits = await createAstroCodeHighlightEdits(
    source,
    analysis.pages,
    filePath,
    codeHighlight,
  );
  const pageImportEdits = pageComponentImport
    ? [
        {
          ...analysis.pageImportSpan,
          value: JSON.stringify(pageComponentImport),
        },
      ]
    : [];
  const code = escapeRawCodeTextBraces(
    applySourceEdits(source, [...analysis.edits, ...codeEdits, ...pageImportEdits]),
  );
  return {
    code: markTransformedAstroSource(code),
    layouts: analysis.layouts,
  };
}

function findMatchingBrace(source: string, openIndex: number) {
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  for (let index = openIndex; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findCompiledPageRenderMatches(source: string) {
  compiledPageRenderPattern.lastIndex = 0;
  return [...source.matchAll(compiledPageRenderPattern)];
}

function findCompiledPagePropsSpans(source: string) {
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of findCompiledPageRenderMatches(source)) {
    const start = source.indexOf("{", match.index + match[0].length);
    if (start < 0) break;
    const end = findMatchingBrace(source, start);
    if (end < 0) break;
    spans.push({ start, end: end + 1 });
  }
  return spans;
}

function addCompiledLayoutProp(
  source: string,
  span: { start: number; end: number },
  layout: string,
  themeName?: string,
) {
  const body = source.slice(span.start + 1, span.end - 1).trim();
  const prop = themeName
    ? ` "theme": ${JSON.stringify(themeName)}, "layout": ${JSON.stringify(layout)}`
    : ` "layout": ${JSON.stringify(layout)}`;
  const replacement =
    body.length === 0 ? `{${prop} }` : `{${prop},${source.slice(span.start + 1, span.end - 1)}}`;
  return { start: span.start, end: span.end, value: replacement };
}

// Exported for tests only; not part of the public package surface (index.ts).
export function transformCompiledAstroDeckSource(
  source: string,
  layouts: AstroPageLayout[],
  filePath: string,
  themeName?: string,
) {
  const propSpans = findCompiledPagePropsSpans(source);
  if (propSpans.length !== layouts.length) {
    throw new Error(
      `Failed to transform Astro deck ${filePath}: compiled Page count ${propSpans.length} does not match analyzed page count ${layouts.length}.`,
    );
  }
  const edits = propSpans.map((span, index) =>
    addCompiledLayoutProp(source, span, layouts[index].layout, themeName),
  );
  return applySourceEdits(source, edits).replace(/<layout(?:\s+[^<>]*)?><\/layout>/g, "");
}

function hasThemeLayouts(theme?: DeckupResolvedTheme) {
  return (theme?.layouts?.length ?? 0) > 0;
}

function createThemeModuleImport(theme: DeckupResolvedTheme | undefined, moduleId: string) {
  return hasThemeLayouts(theme) ? `import ${JSON.stringify(moduleId)};` : undefined;
}

function assertPluginTheme(theme?: DeckupResolvedTheme) {
  if (!theme || hasThemeLayouts(theme)) return;
  throw new Error(
    `Deckup theme ${JSON.stringify(theme.name)} must resolve from layouts/*.astro before installing Deckup Vite plugins.`,
  );
}

function resolveThemeForDeck(theme: DeckupThemeLookup, deck: DeckupResolvedDeck) {
  return typeof theme === "function" ? theme(deck) : theme;
}

function uniqueResolvedThemes(themes: Array<DeckupResolvedTheme | undefined>) {
  const byName = new Map<string, DeckupResolvedTheme>();
  for (const theme of themes) {
    if (theme && hasThemeLayouts(theme)) byName.set(theme.name, theme);
  }
  return [...byName.values()];
}

function themesForRuntime(theme: DeckupThemeLookup, decks: DeckupResolvedDeck[] = []) {
  return typeof theme === "function"
    ? uniqueResolvedThemes(decks.map((deck) => theme(deck)))
    : uniqueResolvedThemes([theme]);
}

async function refreshThemeLayouts(
  theme?: DeckupResolvedTheme,
  discoverCached: DiscoverThemeLayouts = createThemeLayoutDiscoveryCache(),
): Promise<DeckupResolvedTheme | undefined> {
  if (!theme) return undefined;
  if (!hasThemeLayouts(theme) || !theme.layoutsDir) return theme;

  try {
    const layouts = await discoverCached(theme.name, theme.layoutsDir);
    return {
      ...theme,
      layouts,
      slotNames: uniqueStrings(layouts.flatMap((layout) => layout.slotNames)).sort(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("must include a readable layouts directory")
    ) {
      return theme;
    }
    throw error;
  }
}

async function writeFreshGeneratedPage(
  themes: Array<DeckupResolvedTheme | undefined>,
  options: DeckupVitePluginOptions,
  generatedPageMemo: GeneratedPageMemo,
  defaultThemeName?: string,
) {
  async function writeIfChanged(filePath: string, source: string) {
    if (source === generatedPageMemo.get(filePath)) return;
    try {
      if ((await readFile(filePath, "utf8")) === source) {
        generatedPageMemo.set(filePath, source);
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, source);
    generatedPageMemo.set(filePath, source);
  }

  const resolvedThemes = uniqueResolvedThemes(themes);
  if (resolvedThemes.length === 0) return;
  if (options.generatedPageFilePathForTheme) {
    await Promise.all(
      resolvedThemes.map(async (theme) => {
        const filePath = options.generatedPageFilePathForTheme?.(theme.name);
        if (!filePath) return;
        const source = createGeneratedThemePageComponentSource(theme);
        await writeIfChanged(filePath, source);
      }),
    );
    return;
  }
  if (!options.generatedPageFilePath) return;
  const slotNames = uniqueStrings(resolvedThemes.flatMap((theme) => theme.slotNames ?? [])).sort();
  const source = createGeneratedPageComponentSource(
    slotNames,
    VIRTUAL_DECKUP_THEME_LAYOUTS_ID,
    defaultThemeName,
  );
  await writeIfChanged(options.generatedPageFilePath, source);
}

async function refreshThemeRuntimes(
  themes: DeckupResolvedTheme[],
  options: DeckupVitePluginOptions,
  discoverCached: DiscoverThemeLayouts,
  generatedPageMemo: GeneratedPageMemo,
  keyedByTheme = false,
) {
  const refreshedThemes = (
    await Promise.all(themes.map((theme) => refreshThemeLayouts(theme, discoverCached)))
  ).filter((theme): theme is DeckupResolvedTheme => Boolean(theme));
  await writeFreshGeneratedPage(
    refreshedThemes,
    options,
    generatedPageMemo,
    keyedByTheme ? refreshedThemes[0]?.name : undefined,
  );
  return refreshedThemes;
}

function createThemeLayoutsModule(
  themes: DeckupResolvedTheme[] | DeckupResolvedTheme | undefined,
  keyedByTheme = false,
) {
  const resolvedThemes = Array.isArray(themes) ? themes : themes ? [themes] : [];
  if (!keyedByTheme && resolvedThemes.length <= 1) {
    const layouts = resolvedThemes[0]?.layouts ?? [];
    const imports = layouts
      .map((layout, index) => `import Layout${index} from ${JSON.stringify(layout.importPath)};`)
      .join("\n");
    const entries = layouts
      .map((layout, index) => `  ${JSON.stringify(layout.id)}: Layout${index},`)
      .join("\n");
    return `${imports}

const themeLayouts = {
${entries}
};

export default themeLayouts;
`;
  }

  const imports: string[] = [];
  const themeEntries = resolvedThemes.map((theme) => {
    const layoutEntries = (theme.layouts ?? []).map((layout) => {
      const localName = `Layout${imports.length}`;
      imports.push(`import ${localName} from ${JSON.stringify(layout.importPath)};`);
      return `    ${JSON.stringify(layout.id)}: ${localName},`;
    });
    return `  ${JSON.stringify(theme.name)}: {\n${layoutEntries.join("\n")}\n  },`;
  });
  return `${imports.join("\n")}

const themeLayoutsByName = {
${themeEntries.join("\n")}
};

export default themeLayoutsByName;
`;
}

function validateThemeLayoutIds(
  deck: DeckupResolvedDeck,
  theme: DeckupResolvedTheme | undefined,
  layouts: AstroPageLayout[],
) {
  if (!hasThemeLayouts(theme)) return;
  const available = new Set(theme?.layouts?.map((layout) => layout.id));
  const missing = [...new Set(layouts.map((layout) => layout.layout))]
    .filter((layoutId) => !available.has(layoutId))
    .sort();
  if (missing.length === 0) return;
  throw new Error(
    `Deckup theme ${JSON.stringify(theme?.name)} does not provide layout ${
      missing.length === 1
        ? JSON.stringify(missing[0])
        : missing.map((layoutId) => JSON.stringify(layoutId)).join(", ")
    } required by ${deck.projectRelativePath}. Available layouts: ${[...available]
      .sort()
      .join(", ")}.`,
  );
}

function addThemeLayoutWatchFiles(
  context: { addWatchFile(filePath: string): void },
  theme?: DeckupResolvedTheme,
) {
  if (theme?.layoutsDir) context.addWatchFile(theme.layoutsDir);
  for (const layout of theme?.layouts ?? []) context.addWatchFile(layout.filePath);
}

function createVirtualThemeLayoutsPlugin(
  theme: DeckupThemeLookup,
  registry: DeckupDeckRegistry | undefined,
  options: DeckupVitePluginOptions,
  discoverCached: DiscoverThemeLayouts,
  generatedPageMemo: GeneratedPageMemo,
): Plugin {
  const availableThemes = themesForRuntime(theme, registry?.decks);

  return {
    name: "deckup:virtual-theme-layouts",
    resolveId(id) {
      const parsed = parseThemeLayoutsModuleId(id);
      if (!parsed) return undefined;
      return id.startsWith("\0") ? id : resolvedVirtualId(id);
    },
    async load(id) {
      const parsed = parseThemeLayoutsModuleId(id);
      if (!parsed) return undefined;
      const keyedByTheme = registry !== undefined;
      const selectedThemes = parsed.themeName
        ? availableThemes.filter((candidate) => candidate.name === parsed.themeName)
        : availableThemes;
      if (parsed.themeName && selectedThemes.length === 0) {
        throw new Error(`Deckup theme ${JSON.stringify(parsed.themeName)} is not registered.`);
      }
      const runtimeThemes = await refreshThemeRuntimes(
        selectedThemes,
        options,
        discoverCached,
        generatedPageMemo,
        keyedByTheme,
      );
      for (const runtimeTheme of runtimeThemes) {
        if (runtimeTheme.filePath) this.addWatchFile(runtimeTheme.filePath);
        addThemeLayoutWatchFiles(this, runtimeTheme);
      }
      return createThemeLayoutsModule(runtimeThemes, keyedByTheme);
    },
  };
}

function createAstroDeckModule(
  deck: DeckupResolvedDeck,
  theme: DeckupResolvedTheme | undefined,
  themeLayoutsModuleId: string,
) {
  const source = readFileSync(deck.filePath, "utf8");
  const analysis = analyzeAstroDeckSource(source, deck.filePath);
  validateThemeLayoutIds(deck, theme, analysis.layouts);
  const deckImport = `/${deck.projectRelativePath}`;
  return [
    createThemeModuleImport(theme, themeLayoutsModuleId),
    `import Deck from ${JSON.stringify(deckImport)};`,
    "export default Deck;",
    `export const deck = ${JSON.stringify({
      filePath: deck.filePath,
      projectRelativePath: deck.projectRelativePath,
      format: deck.format,
      pageCount: analysis.pageCount,
      frontmatter: {},
    })};`,
  ]
    .filter(Boolean)
    .join("\n");
}

function createMdxDeckModule(
  deck: DeckupResolvedDeck,
  theme: DeckupResolvedTheme | undefined,
  themeLayoutsModuleId: string,
) {
  const source = readFileSync(deck.filePath, "utf8");
  const analysis = analyzeMdxDeckSource(source, deck.filePath);
  validateThemeLayoutIds(deck, theme, analysis.layouts);
  const deckImport = `/${deck.projectRelativePath}`;
  return [
    createThemeModuleImport(theme, themeLayoutsModuleId),
    `import Deck, { frontmatter } from ${JSON.stringify(deckImport)};`,
    "export default Deck;",
    `export const deck = ${JSON.stringify({
      filePath: deck.filePath,
      projectRelativePath: deck.projectRelativePath,
      format: deck.format,
      pageCount: analysis.pageCount,
    })};`,
    "deck.frontmatter = frontmatter ?? {};",
  ]
    .filter(Boolean)
    .join("\n");
}

function createDeckModule(
  deck: DeckupResolvedDeck,
  theme: DeckupResolvedTheme | undefined,
  themeLayoutsModuleId: string,
) {
  if (deck.format === "astro") return createAstroDeckModule(deck, theme, themeLayoutsModuleId);
  return createMdxDeckModule(deck, theme, themeLayoutsModuleId);
}

function createVirtualRoutePlugin(
  registry: DeckupDeckRegistry,
  options: DeckupVitePluginOptions,
): Plugin {
  const routeIds = new Map(registry.decks.map((deck) => [deck.virtualRouteModuleId, deck]));
  const resolvedRouteIds = new Map(
    registry.decks.map((deck) => [resolvedVirtualId(deck.virtualRouteModuleId), deck]),
  );
  return {
    name: "deckup:virtual-routes",
    resolveId(id) {
      const deck = routeIds.get(id);
      return deck ? resolvedVirtualId(deck.virtualRouteModuleId) : undefined;
    },
    load(id) {
      const deck = resolvedRouteIds.get(id);
      if (!deck) return undefined;
      this.addWatchFile(deck.filePath);
      return createRuntimePageSource(deck.virtualDeckModuleId, {
        deckLayoutModuleId: options.deckLayoutModuleId,
      });
    },
  };
}

function createRegistryVirtualDeckPlugin(
  registry: DeckupDeckRegistry,
  theme: DeckupThemeLookup,
  discoverCached: DiscoverThemeLayouts,
  options: DeckupVitePluginOptions,
): Plugin {
  const deckIds = new Map(registry.decks.map((deck) => [deck.virtualDeckModuleId, deck]));
  const resolvedDeckIds = new Map(
    registry.decks.map((deck) => [resolvedVirtualId(deck.virtualDeckModuleId), deck]),
  );
  return {
    name: "deckup:virtual-decks",
    resolveId(id) {
      const deck = deckIds.get(id);
      return deck ? resolvedVirtualId(deck.virtualDeckModuleId) : undefined;
    },
    async load(id) {
      const deck = resolvedDeckIds.get(id);
      if (!deck) return undefined;
      const runtimeTheme = await refreshThemeLayouts(
        resolveThemeForDeck(theme, deck),
        discoverCached,
      );
      this.addWatchFile(deck.filePath);
      if (runtimeTheme?.filePath) this.addWatchFile(runtimeTheme.filePath);
      addThemeLayoutWatchFiles(this, runtimeTheme);
      const themeLayoutsModuleId = options.generatedPageFilePathForTheme
        ? createThemeLayoutsModuleId(runtimeTheme?.name)
        : VIRTUAL_DECKUP_THEME_LAYOUTS_ID;
      return createDeckModule(deck, runtimeTheme, themeLayoutsModuleId);
    },
  };
}

function createRegistryAstroDeckValidationPlugin(
  registry: DeckupDeckRegistry,
  theme?: DeckupThemeLookup,
  discoverCached: DiscoverThemeLayouts = createThemeLayoutDiscoveryCache(),
  options: DeckupVitePluginOptions = {},
): Plugin {
  function pageComponentImport(runtimeTheme?: DeckupResolvedTheme) {
    if (!runtimeTheme) return undefined;
    const filePath = options.generatedPageFilePathForTheme?.(runtimeTheme.name);
    return filePath ? toViteFsImportPath(filePath) : undefined;
  }

  function matchAstroDeck(id: string): DeckupResolvedDeckRoute | undefined {
    const normalizedId = normalizeIdPath(id.split("?", 1)[0]);
    if (
      normalizedId.startsWith("virtual:deckup/") ||
      normalizedId.startsWith("\0virtual:deckup/")
    ) {
      return undefined;
    }
    const deck = registry.matchId(id);
    return deck?.format === "astro" ? deck : undefined;
  }

  return {
    name: "deckup:astro-deck-validation",
    enforce: "pre",
    async load(id) {
      const deck = matchAstroDeck(id);
      if (!deck) return undefined;
      const source = readFileSync(deck.filePath, "utf8");
      if (!source.includes("<Page")) return undefined;
      const runtimeTheme = await refreshThemeLayouts(
        resolveThemeForDeck(theme, deck),
        discoverCached,
      );
      const result = await transformAstroDeckSourceForBuild(
        source,
        deck.filePath,
        options.codeHighlight,
        runtimeTheme?.name,
        pageComponentImport(runtimeTheme),
      );
      validateThemeLayoutIds(deck, runtimeTheme, result.layouts);
      return result.code;
    },
    async transform(source, id) {
      const deck = matchAstroDeck(id);
      if (!deck) return undefined;
      if (source.includes(transformedSourceMarker)) return undefined;
      const runtimeTheme = await refreshThemeLayouts(
        resolveThemeForDeck(theme, deck),
        discoverCached,
      );
      if (source.includes("<Page")) {
        const result = await transformAstroDeckSourceForBuild(
          source,
          deck.filePath,
          options.codeHighlight,
          runtimeTheme?.name,
          pageComponentImport(runtimeTheme),
        );
        validateThemeLayoutIds(deck, runtimeTheme, result.layouts);
        return result.code;
      }
      if (findCompiledPageRenderMatches(source).length === 0) return undefined;
      const originalSource = readFileSync(deck.filePath, "utf8");
      const { layouts } = analyzeAstroDeckSource(originalSource, deck.filePath, runtimeTheme?.name);
      validateThemeLayoutIds(deck, runtimeTheme, layouts);
      return transformCompiledAstroDeckSource(source, layouts, deck.filePath, runtimeTheme?.name);
    },
  };
}

export function createDeckupVitePluginsForRegistry(
  registry: DeckupDeckRegistry,
  theme?: DeckupThemeLookup,
  options: DeckupVitePluginOptions = {},
): Plugin[] {
  const runtimeThemes = themesForRuntime(theme, registry.decks);
  for (const resolvedTheme of runtimeThemes) assertPluginTheme(resolvedTheme);
  if (
    runtimeThemes.length > 1 &&
    options.generatedPageFilePath &&
    !options.generatedPageFilePathForTheme
  ) {
    throw new Error(
      "Deckup requires generatedPageFilePathForTheme when a registry uses multiple themes.",
    );
  }
  const discoverCached = createThemeLayoutDiscoveryCache();
  const generatedPageMemo: GeneratedPageMemo = new Map();
  return [
    createVirtualThemeLayoutsPlugin(theme, registry, options, discoverCached, generatedPageMemo),
    createVirtualRoutePlugin(registry, options),
    createRegistryVirtualDeckPlugin(registry, theme, discoverCached, options),
    createRegistryAstroDeckValidationPlugin(registry, theme, discoverCached, options),
  ];
}
