import { readFileSync } from "node:fs";
import { sep } from "node:path";

import { parse } from "@astrojs/compiler-rs";
import type { Plugin } from "vite-plus";

import { countMdxDeckPages } from "./slida-mdx-pages.ts";
import type { SlidaResolvedDeck, SlidaResolvedTheme } from "./types.ts";

export const VIRTUAL_SLIDA_DECK_ID = "virtual:slida/deck";

const resolvedVirtualSlidaDeckId = `\0${VIRTUAL_SLIDA_DECK_ID}`;
const pageComponentExport = "@slida/cli/page";

type AstroNode = {
  type?: string;
  value?: string;
  openingElement?: {
    name?: {
      type?: string;
      name?: string;
    };
  };
};

type AstroImportDeclaration = {
  type?: string;
  source?: {
    value?: unknown;
  };
  specifiers?: Array<{
    type?: string;
    local?: {
      name?: string;
    };
  }>;
};

type AstroRoot = {
  type?: "AstroRoot";
  frontmatter?: {
    program?: {
      body?: AstroImportDeclaration[];
    };
  };
  body?: AstroNode[];
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

function isWhitespace(node: AstroNode) {
  return node.type === "JSXText" && (node.value ?? "").trim().length === 0;
}

function isTopLevelPage(node: AstroNode) {
  const name = node.openingElement?.name;
  return node.type === "JSXElement" && name?.type === "JSXIdentifier" && name.name === "Page";
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
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const node = value as AstroRoot & Record<string, unknown>;
  if (node.type === "AstroRoot") {
    return node;
  }

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
  if (!ast) {
    throw new Error(`Failed to parse Astro deck ${filePath}: AstroRoot not found`);
  }

  return ast;
}

export function countAstroDeckPages(source: string, filePath = "<deck>") {
  const ast = parseAstroDeck(source, filePath);
  return (ast.body ?? []).filter(isTopLevelPage).length;
}

export function validateAstroDeckSource(source: string, filePath = "<deck>") {
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

  const pageCount = (ast.body ?? []).filter(isTopLevelPage).length;
  if (pageCount === 0) {
    throw new Error(`Astro deck must contain at least one top-level <Page>: ${filePath}`);
  }

  return pageCount;
}

function createThemeCssImport(theme?: SlidaResolvedTheme) {
  return theme ? `import ${JSON.stringify(theme.importPath)};` : undefined;
}

function createAstroDeckModule(deck: SlidaResolvedDeck, theme?: SlidaResolvedTheme) {
  const source = readFileSync(deck.filePath, "utf8");
  const pageCount = validateAstroDeckSource(source, deck.filePath);
  const deckImport = `/${deck.projectRelativePath}`;

  return [
    createThemeCssImport(theme),
    `import Deck from ${JSON.stringify(deckImport)};`,
    "export default Deck;",
    `export const deck = ${JSON.stringify({
      filePath: deck.filePath,
      projectRelativePath: deck.projectRelativePath,
      format: deck.format,
      pageCount,
      frontmatter: {},
    })};`,
  ]
    .filter(Boolean)
    .join("\n");
}

function createMdxDeckModule(deck: SlidaResolvedDeck, theme?: SlidaResolvedTheme) {
  const source = readFileSync(deck.filePath, "utf8");
  const pageCount = countMdxDeckPages(source);
  const deckImport = `/${deck.projectRelativePath}`;

  return [
    createThemeCssImport(theme),
    `import Deck, { frontmatter } from ${JSON.stringify(deckImport)};`,
    "export default Deck;",
    `export const deck = ${JSON.stringify({
      filePath: deck.filePath,
      projectRelativePath: deck.projectRelativePath,
      format: deck.format,
      pageCount,
    })};`,
    "deck.frontmatter = frontmatter ?? {};",
  ]
    .filter(Boolean)
    .join("\n");
}

function createVirtualDeckPlugin(deck: SlidaResolvedDeck, theme?: SlidaResolvedTheme): Plugin {
  return {
    name: "slida:virtual-deck",
    resolveId(id) {
      return id === VIRTUAL_SLIDA_DECK_ID ? resolvedVirtualSlidaDeckId : undefined;
    },
    load(id) {
      if (id !== resolvedVirtualSlidaDeckId) {
        return undefined;
      }

      this.addWatchFile(deck.filePath);
      if (theme?.filePath) {
        this.addWatchFile(theme.filePath);
      }

      if (deck.format === "astro") {
        return createAstroDeckModule(deck, theme);
      }

      return createMdxDeckModule(deck, theme);
    },
  };
}

function createAstroDeckValidationPlugin(deck: SlidaResolvedDeck): Plugin {
  return {
    name: "slida:astro-deck-validation",
    enforce: "pre",
    transform(source, id) {
      if (deck.format !== "astro" || !isSelectedDeckId(id, deck)) {
        return undefined;
      }

      if (source !== readFileSync(deck.filePath, "utf8")) {
        return undefined;
      }

      validateAstroDeckSource(source, deck.filePath);
      return undefined;
    },
  };
}

export function createSlidaVitePlugins(
  deck: SlidaResolvedDeck,
  theme?: SlidaResolvedTheme,
): Plugin[] {
  return [createVirtualDeckPlugin(deck, theme), createAstroDeckValidationPlugin(deck)];
}
