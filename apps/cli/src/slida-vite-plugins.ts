import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, sep } from "node:path";

import { parse } from "@astrojs/compiler-rs";
import type { Plugin } from "vite-plus";

import { resolveSlidaLayout } from "./layout.ts";
import { analyzeMdxDeckSource } from "./slida-mdx-pages.ts";
import {
  VIRTUAL_SLIDA_THEME_LAYOUTS_ID,
  createGeneratedPageComponentSource,
  discoverThemeLayouts,
} from "./theme-layouts.ts";
import type { SlidaResolvedDeck, SlidaResolvedTheme } from "./types.ts";

export const VIRTUAL_SLIDA_DECK_ID = "virtual:slida/deck";

const resolvedVirtualSlidaDeckId = `\0${VIRTUAL_SLIDA_DECK_ID}`;
const resolvedVirtualSlidaThemeLayoutsId = `\0${VIRTUAL_SLIDA_THEME_LAYOUTS_ID}`;
const pageComponentExport = "@slida/cli/page";

type AstroIdentifier = { type?: string; name?: string };
type AstroAttribute = {
  type?: string;
  name?: AstroIdentifier;
  value?: { type?: string; value?: unknown; raw?: string } | null;
  start?: number;
  end?: number;
};
type AstroNode = {
  type?: string;
  value?: string;
  start?: number;
  end?: number;
  openingElement?: {
    name?: AstroIdentifier;
    attributes?: AstroAttribute[];
    selfClosing?: boolean;
    start?: number;
    end?: number;
  };
  children?: AstroNode[];
};
type AstroImportDeclaration = {
  type?: string;
  source?: { value?: unknown };
  specifiers?: Array<{ type?: string; local?: { name?: string } }>;
};
type AstroRoot = {
  type?: "AstroRoot";
  frontmatter?: { program?: { body?: AstroImportDeclaration[] } };
  body?: AstroNode[];
};
type AstroSourceEdit = { start: number; end: number; value: string };
type AstroPageLayout = { layout: string };
type SlidaVitePluginOptions = {
  generatedPageFilePath?: string;
};

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function stripQuery(id: string) {
  return id.split("?", 1)[0];
}

function isSelectedDeckId(id: string, deck: SlidaResolvedDeck) {
  const normalizedId = normalizePath(stripQuery(id));
  const normalizedFilePath = normalizePath(deck.filePath);
  return (
    normalizedId === normalizedFilePath || normalizedId.endsWith(`/${deck.projectRelativePath}`)
  );
}

function getIdentifierName(name?: AstroIdentifier) {
  return name?.type === "JSXIdentifier" ? name.name : undefined;
}

function isWhitespace(node: AstroNode) {
  return node.type === "JSXText" && (node.value ?? "").trim().length === 0;
}

function isJsxElementNamed(node: AstroNode, name: string) {
  return node.type === "JSXElement" && getIdentifierName(node.openingElement?.name) === name;
}

function isTopLevelPage(node: AstroNode) {
  return isJsxElementNamed(node, "Page");
}

function isLayoutDeclaration(node: AstroNode) {
  return isJsxElementNamed(node, "layout");
}

function getAttributeName(attribute: AstroAttribute) {
  return getIdentifierName(attribute.name);
}

function getAttribute(node: AstroNode, name: string) {
  return node.openingElement?.attributes?.find((attribute) => getAttributeName(attribute) === name);
}

function hasAttribute(node: AstroNode, name: string) {
  return getAttribute(node, name) !== undefined;
}

function hasDefaultPageImport(ast: AstroRoot) {
  return (
    ast.frontmatter?.program?.body?.some((node) => {
      if (node.type !== "ImportDeclaration" || node.source?.value !== pageComponentExport) {
        return false;
      }
      return node.specifiers?.some(
        (specifier) =>
          specifier.type === "ImportDefaultSpecifier" && specifier.local?.name === "Page",
      );
    }) ?? false
  );
}

function findAstroRoot(value: unknown): AstroRoot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const node = value as AstroRoot & Record<string, unknown>;
  if (node.type === "AstroRoot") return node;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findAstroRoot(item);
        if (found) return found;
      }
    } else {
      const found = findAstroRoot(child);
      if (found) return found;
    }
  }
  return undefined;
}

function parseAstroDeck(source: string, filePath: string) {
  const result = parse(source);
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

function toSourceIndex(source: string, byteOffset: number, context: string) {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new Error(`Failed to transform Astro deck: invalid source offset for ${context}.`);
  }

  let bytes = 0;
  for (let index = 0; index < source.length; ) {
    if (bytes === byteOffset) {
      return index;
    }

    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const character = String.fromCodePoint(codePoint);
    bytes += new TextEncoder().encode(character).length;
    index += character.length;
  }

  if (bytes === byteOffset) {
    return source.length;
  }

  throw new Error(
    `Failed to transform Astro deck: source offset ${byteOffset} is not a UTF-8 boundary for ${context}.`,
  );
}

function getRequiredSpan(source: string, node: AstroNode, context: string) {
  if (typeof node.start !== "number" || typeof node.end !== "number") {
    throw new Error(`Failed to transform Astro deck: missing source span for ${context}.`);
  }
  return {
    start: toSourceIndex(source, node.start, `${context} start`),
    end: toSourceIndex(source, node.end, `${context} end`),
  };
}

function getPageAttributeInsertionOffset(source: string, page: AstroNode, context: string) {
  const end = page.openingElement?.end;
  if (typeof end !== "number") {
    throw new Error(`Failed to transform Astro deck: missing opening tag span for ${context}.`);
  }
  const endIndex = toSourceIndex(source, end, `${context} opening tag end`);
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
  return { layout: resolveSlidaLayout(explicitLayout, pageIndex, context), layoutNodes };
}

function analyzeAstroLayouts(source: string, pages: AstroNode[], filePath: string) {
  const edits: AstroSourceEdit[] = [];
  const layouts: AstroPageLayout[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const context = `${filePath} page ${pageIndex + 1}`;
    const { layout, layoutNodes } = resolveAstroPageLayout(page, pageIndex, filePath);
    layouts.push({ layout });
    const insertAt = getPageAttributeInsertionOffset(source, page, context);
    edits.push({ start: insertAt, end: insertAt, value: ` layout=${JSON.stringify(layout)}` });
    for (const layoutNode of layoutNodes) {
      edits.push({ ...getRequiredSpan(source, layoutNode, context), value: "" });
    }
  }
  return { edits, layouts };
}

function applySourceEdits(source: string, edits: AstroSourceEdit[]) {
  return [...edits]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((code, edit) => code.slice(0, edit.start) + edit.value + code.slice(edit.end), source);
}

function analyzeAstroDeckSource(source: string, filePath: string) {
  const ast = parseAstroDeck(source, filePath);
  if (!hasDefaultPageImport(ast)) {
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
  const { edits, layouts } = analyzeAstroLayouts(source, pages, filePath);
  return { pageCount: pages.length, edits, layouts };
}

export function countAstroDeckPages(source: string, filePath = "<deck>") {
  const ast = parseAstroDeck(source, filePath);
  return (ast.body ?? []).filter(isTopLevelPage).length;
}

export function validateAstroDeckSource(source: string, filePath = "<deck>") {
  return analyzeAstroDeckSource(source, filePath).pageCount;
}

export function transformAstroDeckSource(source: string, filePath = "<deck>") {
  return applySourceEdits(source, analyzeAstroDeckSource(source, filePath).edits);
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

function findCompiledPagePropsSpans(source: string) {
  const marker = '$$renderComponent($$result, "Page", Page,';
  const spans: Array<{ start: number; end: number }> = [];
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const markerIndex = source.indexOf(marker, searchIndex);
    if (markerIndex < 0) break;
    const start = source.indexOf("{", markerIndex + marker.length);
    if (start < 0) break;
    const end = findMatchingBrace(source, start);
    if (end < 0) break;
    spans.push({ start, end: end + 1 });
    searchIndex = end + 1;
  }
  return spans;
}

function addCompiledLayoutProp(
  source: string,
  span: { start: number; end: number },
  layout: string,
) {
  const body = source.slice(span.start + 1, span.end - 1).trim();
  const prop = ` "layout": ${JSON.stringify(layout)}`;
  const replacement =
    body.length === 0 ? `{${prop} }` : `{${prop},${source.slice(span.start + 1, span.end - 1)}}`;
  return { start: span.start, end: span.end, value: replacement };
}

function transformCompiledAstroDeckSource(
  source: string,
  layouts: AstroPageLayout[],
  filePath: string,
) {
  const propSpans = findCompiledPagePropsSpans(source);
  if (propSpans.length !== layouts.length) {
    throw new Error(
      `Failed to transform Astro deck ${filePath}: compiled Page count ${propSpans.length} does not match analyzed page count ${layouts.length}.`,
    );
  }
  const edits = propSpans.map((span, index) =>
    addCompiledLayoutProp(source, span, layouts[index].layout),
  );
  return applySourceEdits(source, edits).replace(/<layout(?:\s+[^<>]*)?><\/layout>/g, "");
}

function hasThemeLayouts(theme?: SlidaResolvedTheme) {
  return (theme?.layouts?.length ?? 0) > 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function createThemeModuleImport(theme?: SlidaResolvedTheme) {
  if (hasThemeLayouts(theme)) return `import ${JSON.stringify(VIRTUAL_SLIDA_THEME_LAYOUTS_ID)};`;
  return undefined;
}

function assertPluginTheme(theme?: SlidaResolvedTheme) {
  if (!theme || hasThemeLayouts(theme)) return;
  throw new Error(
    `Slida theme ${JSON.stringify(theme.name)} must resolve from layouts/*.astro before installing Slida Vite plugins.`,
  );
}

async function refreshThemeLayouts(
  theme?: SlidaResolvedTheme,
): Promise<SlidaResolvedTheme | undefined> {
  if (!theme) return undefined;
  if (!hasThemeLayouts(theme) || !theme.layoutsDir) return theme;

  try {
    const layouts = await discoverThemeLayouts(theme.name, theme.layoutsDir);
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
  theme: SlidaResolvedTheme | undefined,
  options: SlidaVitePluginOptions,
) {
  if (!theme || !hasThemeLayouts(theme) || !options.generatedPageFilePath) return;
  await mkdir(dirname(options.generatedPageFilePath), { recursive: true });
  await writeFile(
    options.generatedPageFilePath,
    createGeneratedPageComponentSource(theme.slotNames ?? [], VIRTUAL_SLIDA_THEME_LAYOUTS_ID),
  );
}

async function refreshThemeRuntime(
  theme: SlidaResolvedTheme | undefined,
  options: SlidaVitePluginOptions,
) {
  const refreshedTheme = await refreshThemeLayouts(theme);
  await writeFreshGeneratedPage(refreshedTheme, options);
  return refreshedTheme;
}

function createThemeLayoutsModule(theme?: SlidaResolvedTheme) {
  const layouts = theme?.layouts ?? [];
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

function validateThemeLayoutIds(
  deck: SlidaResolvedDeck,
  theme: SlidaResolvedTheme | undefined,
  layouts: AstroPageLayout[],
) {
  if (!hasThemeLayouts(theme)) return;
  const available = new Set(theme?.layouts?.map((layout) => layout.id));
  const missing = [...new Set(layouts.map((layout) => layout.layout))]
    .filter((layoutId) => !available.has(layoutId))
    .sort();
  if (missing.length === 0) return;
  throw new Error(
    `Slida theme ${JSON.stringify(theme?.name)} does not provide layout ${
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
  theme?: SlidaResolvedTheme,
) {
  if (theme?.layoutsDir) context.addWatchFile(theme.layoutsDir);
  for (const layout of theme?.layouts ?? []) context.addWatchFile(layout.filePath);
}

function createVirtualThemeLayoutsPlugin(
  theme: SlidaResolvedTheme | undefined,
  options: SlidaVitePluginOptions,
): Plugin {
  return {
    name: "slida:virtual-theme-layouts",
    resolveId(id) {
      return id === VIRTUAL_SLIDA_THEME_LAYOUTS_ID ? resolvedVirtualSlidaThemeLayoutsId : undefined;
    },
    async load(id) {
      if (id !== resolvedVirtualSlidaThemeLayoutsId) return undefined;
      const runtimeTheme = await refreshThemeRuntime(theme, options);
      addThemeLayoutWatchFiles(this, runtimeTheme);
      return createThemeLayoutsModule(runtimeTheme);
    },
  };
}

function createAstroDeckModule(deck: SlidaResolvedDeck, theme?: SlidaResolvedTheme) {
  const source = readFileSync(deck.filePath, "utf8");
  const analysis = analyzeAstroDeckSource(source, deck.filePath);
  validateThemeLayoutIds(deck, theme, analysis.layouts);
  const deckImport = `/${deck.projectRelativePath}`;
  return [
    createThemeModuleImport(theme),
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

function createMdxDeckModule(deck: SlidaResolvedDeck, theme?: SlidaResolvedTheme) {
  const source = readFileSync(deck.filePath, "utf8");
  const analysis = analyzeMdxDeckSource(source, deck.filePath);
  validateThemeLayoutIds(deck, theme, analysis.layouts);
  const deckImport = `/${deck.projectRelativePath}`;
  return [
    createThemeModuleImport(theme),
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

function createVirtualDeckPlugin(
  deck: SlidaResolvedDeck,
  theme: SlidaResolvedTheme | undefined,
  options: SlidaVitePluginOptions,
): Plugin {
  return {
    name: "slida:virtual-deck",
    resolveId(id) {
      return id === VIRTUAL_SLIDA_DECK_ID ? resolvedVirtualSlidaDeckId : undefined;
    },
    async load(id) {
      if (id !== resolvedVirtualSlidaDeckId) return undefined;
      const runtimeTheme = await refreshThemeRuntime(theme, options);
      this.addWatchFile(deck.filePath);
      if (runtimeTheme?.filePath) this.addWatchFile(runtimeTheme.filePath);
      addThemeLayoutWatchFiles(this, runtimeTheme);
      if (deck.format === "astro") return createAstroDeckModule(deck, runtimeTheme);
      return createMdxDeckModule(deck, runtimeTheme);
    },
  };
}

function createAstroDeckValidationPlugin(
  deck: SlidaResolvedDeck,
  theme?: SlidaResolvedTheme,
): Plugin {
  return {
    name: "slida:astro-deck-validation",
    enforce: "pre",
    async transform(source, id) {
      if (deck.format !== "astro" || !isSelectedDeckId(id, deck)) return undefined;
      const runtimeTheme = await refreshThemeLayouts(theme);
      if (source.includes("<Page")) {
        const analysis = analyzeAstroDeckSource(source, deck.filePath);
        validateThemeLayoutIds(deck, runtimeTheme, analysis.layouts);
        return applySourceEdits(source, analysis.edits);
      }
      if (!source.includes('$$renderComponent($$result, "Page", Page,')) return undefined;
      const originalSource = readFileSync(deck.filePath, "utf8");
      const { layouts } = analyzeAstroDeckSource(originalSource, deck.filePath);
      validateThemeLayoutIds(deck, runtimeTheme, layouts);
      return transformCompiledAstroDeckSource(source, layouts, deck.filePath);
    },
  };
}

export function createSlidaVitePlugins(
  deck: SlidaResolvedDeck,
  theme?: SlidaResolvedTheme,
  options: SlidaVitePluginOptions = {},
): Plugin[] {
  assertPluginTheme(theme);
  return [
    createVirtualThemeLayoutsPlugin(theme, options),
    createVirtualDeckPlugin(deck, theme, options),
    createAstroDeckValidationPlugin(deck, theme),
  ];
}
