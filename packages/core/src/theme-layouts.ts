import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { parse } from "@astrojs/compiler-rs";

import { findAstroRoot, getAttribute, isJsxElementNamed, type AstroNode } from "./astro-ast.ts";
import { assertValidDeckupLayoutId } from "./layout.ts";
import type { DeckupResolvedTheme, DeckupResolvedThemeLayout } from "./types.ts";
import { normalizePath } from "./utils.ts";

export const VIRTUAL_DECKUP_THEME_LAYOUTS_ID = "virtual:deckup/theme-layouts";

export function createThemeLayoutsModuleId(themeName?: string) {
  return themeName === undefined
    ? VIRTUAL_DECKUP_THEME_LAYOUTS_ID
    : `${VIRTUAL_DECKUP_THEME_LAYOUTS_ID}?theme=${encodeURIComponent(themeName)}`;
}

export function parseThemeLayoutsModuleId(id: string) {
  const unresolvedId = id.startsWith("\0") ? id.slice(1) : id;
  if (unresolvedId === VIRTUAL_DECKUP_THEME_LAYOUTS_ID) return { themeName: undefined };
  const prefix = `${VIRTUAL_DECKUP_THEME_LAYOUTS_ID}?theme=`;
  if (!unresolvedId.startsWith(prefix)) return undefined;
  try {
    return { themeName: decodeURIComponent(unresolvedId.slice(prefix.length)) };
  } catch {
    return undefined;
  }
}

export function toViteFsImportPath(filePath: string) {
  return `/@fs/${normalizePath(filePath)}`;
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

function parseAstroLayout(source: string, filePath: string) {
  const result = parse(source);
  if (result.diagnostics.length > 0) {
    throw new Error(
      `Failed to parse Deckup theme layout ${filePath}: ${result.diagnostics[0]?.text ?? "unknown parse error"}`,
    );
  }
  const parsedAst = typeof result.ast === "string" ? JSON.parse(result.ast) : result.ast;
  const ast = findAstroRoot(parsedAst);
  if (!ast) throw new Error(`Failed to parse Deckup theme layout ${filePath}: AstroRoot not found`);
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

type AstroSlotMetadata = {
  hasDefaultSlot: boolean;
  slotNames: string[];
};

function extractAstroSlotMetadata(source: string, filePath: string): AstroSlotMetadata {
  const ast = parseAstroLayout(source, filePath);
  let hasDefaultSlot = false;
  const slotNames = new Set<string>();
  visitAstroNodes(ast, (node) => {
    if (!isJsxElementNamed(node, "slot")) return;
    if (!getAttribute(node, "name")) {
      hasDefaultSlot = true;
      return;
    }
    const slotName = getStringAttribute(node, "name", filePath)?.trim();
    if (slotName) slotNames.add(slotName);
  });
  return { hasDefaultSlot, slotNames: [...slotNames].sort() };
}

export function extractAstroSlotNames(source: string, filePath: string) {
  return extractAstroSlotMetadata(source, filePath).slotNames;
}

async function assertReadableAstroLayout(themeName: string, layoutId: string, filePath: string) {
  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    throw new Error(
      `Deckup theme ${JSON.stringify(themeName)} layout ${JSON.stringify(layoutId)} is not readable: ${filePath}`,
      { cause: error },
    );
  }
}

function layoutIdFromFileName(fileName: string) {
  return basename(fileName, extname(fileName));
}

async function fingerprintLayoutsDir(layoutsDir: string) {
  const entries = await readdir(layoutsDir, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) => entry.isFile() && extname(entry.name) === ".astro" && !entry.name.startsWith("_"),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const stats = await Promise.all(
    files.map(async (entry) => {
      const fileStat = await stat(join(layoutsDir, entry.name));
      return `${entry.name}:${fileStat.mtimeMs}:${fileStat.size}`;
    }),
  );
  return stats.join("|");
}

export async function discoverThemeLayouts(
  themeName: string,
  layoutsDir: string,
): Promise<DeckupResolvedThemeLayout[]> {
  let entries;
  try {
    entries = await readdir(layoutsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Deckup theme ${JSON.stringify(themeName)} must include a readable layouts directory: ${layoutsDir}`,
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
      `Deckup theme ${JSON.stringify(themeName)} must include at least one layouts/*.astro component.`,
    );
  }

  return Promise.all(
    layoutFiles.map(async (entry) => {
      const id = layoutIdFromFileName(entry.name);
      assertValidDeckupLayoutId(id, `${themeName} theme layout ${entry.name}`);
      const filePath = join(layoutsDir, entry.name);
      await assertReadableAstroLayout(themeName, id, filePath);
      const source = await readFile(filePath, "utf8");
      const { hasDefaultSlot, slotNames } = extractAstroSlotMetadata(source, filePath);
      return {
        id,
        filePath,
        importPath: toViteFsImportPath(filePath),
        hasDefaultSlot,
        slotNames,
      };
    }),
  );
}

export function createThemeLayoutDiscoveryCache() {
  type CacheEntry = {
    fingerprint: string;
    layouts?: DeckupResolvedThemeLayout[];
    pending?: Promise<DeckupResolvedThemeLayout[]>;
  };
  const cache = new Map<string, CacheEntry>();

  return async function discoverCached(themeName: string, layoutsDir: string) {
    let fingerprint: string | undefined;
    try {
      fingerprint = await fingerprintLayoutsDir(layoutsDir);
    } catch {
      // Fall through: let discoverThemeLayouts produce its canonical error.
    }
    if (fingerprint === undefined) return discoverThemeLayouts(themeName, layoutsDir);

    const cached = cache.get(layoutsDir);
    if (cached?.fingerprint === fingerprint) {
      if (cached.layouts) return cached.layouts;
      if (cached.pending) return cached.pending;
    }

    const pending = discoverThemeLayouts(themeName, layoutsDir);
    cache.set(layoutsDir, { fingerprint, pending });
    try {
      const layouts = await pending;
      cache.set(layoutsDir, { fingerprint, layouts });
      return layouts;
    } catch (error) {
      if (cache.get(layoutsDir)?.pending === pending) cache.delete(layoutsDir);
      throw error;
    }
  };
}

export function createGeneratedPageComponentSource(
  slotNames: string[],
  themeLayoutsModuleId: string,
  defaultThemeName?: string,
) {
  const slotForwards = slotNames
    .map(
      (slotName) =>
        `    <slot name=${JSON.stringify(slotName)} slot=${JSON.stringify(slotName)} />`,
    )
    .join("\n");
  const forwardedSlots = slotForwards.length > 0 ? `\n${slotForwards}` : "";
  const defaultThemeInitializer =
    defaultThemeName === undefined ? "undefined" : JSON.stringify(defaultThemeName);

  return `---
import themeLayoutsByName from ${JSON.stringify(themeLayoutsModuleId)};

interface Props {
  title?: string;
  class?: string;
  layout?: string;
  theme?: string;
}

const {
  title,
  class: className,
  layout = "default",
  theme = ${defaultThemeInitializer},
} = Astro.props;
const themeLayouts = theme
  ? themeLayoutsByName[theme as keyof typeof themeLayoutsByName]
  : themeLayoutsByName;
const Layout = themeLayouts?.[layout as keyof typeof themeLayouts];

if (!Layout) {
  throw new Error(\`Deckup theme \${theme ? JSON.stringify(theme) : "<default>"} layout \${JSON.stringify(layout)} is not available.\`);
}
---

<section
  class:list={["deckup-slide", className]}
  data-deckup-slide
  data-deckup-theme={theme}
  data-deckup-layout={layout}
  aria-label={title ?? "Slide"}
>
  <Layout>
    <slot />${forwardedSlots}
  </Layout>
</section>
`;
}

export function createGeneratedThemePageComponentSource(theme: DeckupResolvedTheme) {
  return createGeneratedPageComponentSource(
    theme.slotNames ?? [],
    createThemeLayoutsModuleId(theme.name),
    theme.name,
  );
}
