import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";

import { parse } from "@astrojs/compiler-rs";

import { assertValidSlidaLayoutId } from "./layout.ts";
import type { SlidaResolvedThemeLayout } from "./types.ts";

export const VIRTUAL_SLIDA_THEME_LAYOUTS_ID = "virtual:slida/theme-layouts";

type AstroIdentifier = { type?: string; name?: string };
type AstroAttribute = {
  type?: string;
  name?: AstroIdentifier;
  value?: { type?: string; value?: unknown; raw?: string } | null;
};
type AstroNode = {
  type?: string;
  value?: string;
  openingElement?: {
    name?: AstroIdentifier;
    attributes?: AstroAttribute[];
  };
  children?: AstroNode[];
};
type AstroRoot = {
  type?: "AstroRoot";
  body?: AstroNode[];
};

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

export function toViteFsImportPath(filePath: string) {
  return `/@fs/${normalizePath(filePath)}`;
}

function getIdentifierName(name?: AstroIdentifier) {
  return name?.type === "JSXIdentifier" ? name.name : undefined;
}

function isJsxElementNamed(node: AstroNode, name: string) {
  return node.type === "JSXElement" && getIdentifierName(node.openingElement?.name) === name;
}

function getAttributeName(attribute: AstroAttribute) {
  return getIdentifierName(attribute.name);
}

function getAttribute(node: AstroNode, name: string) {
  return node.openingElement?.attributes?.find((attribute) => getAttributeName(attribute) === name);
}

function getStringAttribute(node: AstroNode, name: string, context: string) {
  const attribute = getAttribute(node, name);
  if (!attribute || attribute.value === null || attribute.value === undefined) {
    return undefined;
  }
  if (attribute.value.type !== "Literal" || typeof attribute.value.value !== "string") {
    throw new TypeError(
      `Astro slot declaration in ${context} must use a string ${name} attribute.`,
    );
  }
  return attribute.value.value;
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

function parseAstroLayout(source: string, filePath: string) {
  const result = parse(source);
  if (result.diagnostics.length > 0) {
    throw new Error(
      `Failed to parse Slida theme layout ${filePath}: ${result.diagnostics[0]?.text ?? "unknown parse error"}`,
    );
  }
  const parsedAst = typeof result.ast === "string" ? JSON.parse(result.ast) : result.ast;
  const ast = findAstroRoot(parsedAst);
  if (!ast) throw new Error(`Failed to parse Slida theme layout ${filePath}: AstroRoot not found`);
  return ast;
}

function visitAstroNodes(value: unknown, visit: (node: AstroNode) => void) {
  if (typeof value !== "object" || value === null) return;
  const node = value as AstroNode & Record<string, unknown>;
  visit(node);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) visitAstroNodes(item, visit);
    } else {
      visitAstroNodes(child, visit);
    }
  }
}

export function extractAstroSlotNames(source: string, filePath: string) {
  const ast = parseAstroLayout(source, filePath);
  const slotNames = new Set<string>();
  visitAstroNodes(ast, (node) => {
    if (!isJsxElementNamed(node, "slot")) return;
    const slotName = getStringAttribute(node, "name", filePath)?.trim();
    if (slotName) slotNames.add(slotName);
  });
  return [...slotNames].sort();
}

async function assertReadableAstroLayout(themeName: string, layoutId: string, filePath: string) {
  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    throw new Error(
      `Slida theme ${JSON.stringify(themeName)} layout ${JSON.stringify(layoutId)} is not readable: ${filePath}`,
      { cause: error },
    );
  }
}

function layoutIdFromFileName(fileName: string) {
  return basename(fileName, extname(fileName));
}

export async function discoverThemeLayouts(
  themeName: string,
  layoutsDir: string,
): Promise<SlidaResolvedThemeLayout[]> {
  let entries;
  try {
    entries = await readdir(layoutsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Slida theme ${JSON.stringify(themeName)} must include a readable layouts directory: ${layoutsDir}`,
      { cause: error },
    );
  }

  const layoutFiles = entries
    .filter(
      (entry) => entry.isFile() && extname(entry.name) === ".astro" && !entry.name.startsWith("_"),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (layoutFiles.length === 0) {
    throw new Error(
      `Slida theme ${JSON.stringify(themeName)} must include at least one layouts/*.astro component.`,
    );
  }

  const layouts: SlidaResolvedThemeLayout[] = [];
  for (const entry of layoutFiles) {
    const id = layoutIdFromFileName(entry.name);
    assertValidSlidaLayoutId(id, `${themeName} theme layout ${entry.name}`);
    const filePath = join(layoutsDir, entry.name);
    await assertReadableAstroLayout(themeName, id, filePath);
    const source = await readFile(filePath, "utf8");
    layouts.push({
      id,
      filePath,
      importPath: toViteFsImportPath(filePath),
      slotNames: extractAstroSlotNames(source, filePath),
    });
  }

  return layouts;
}

export function createGeneratedPageComponentSource(
  slotNames: string[],
  themeLayoutsModuleId: string,
) {
  const slotForwards = slotNames
    .map(
      (slotName) =>
        `    <slot name=${JSON.stringify(slotName)} slot=${JSON.stringify(slotName)} />`,
    )
    .join("\n");
  const forwardedSlots = slotForwards.length > 0 ? `\n${slotForwards}` : "";

  return `---
import themeLayouts from ${JSON.stringify(themeLayoutsModuleId)};

interface Props {
  title?: string;
  class?: string;
  layout?: string;
}

const { title, class: className, layout = "default" } = Astro.props;
const Layout = themeLayouts[layout as keyof typeof themeLayouts];

if (!Layout) {
  throw new Error(\`Slida theme layout \${JSON.stringify(layout)} is not available.\`);
}
---

<section
  class:list={["slida-slide", className]}
  data-slida-slide
  data-slida-layout={layout}
  aria-label={title ?? "Slide"}
>
  <Layout>
    <slot />${forwardedSlots}
  </Layout>
</section>
`;
}
