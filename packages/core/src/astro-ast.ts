export type AstroIdentifier = { type?: string; name?: string };
export type AstroAttribute = {
  type?: string;
  name?: AstroIdentifier;
  value?: { type?: string; value?: unknown; raw?: string } | null;
  start?: number;
  end?: number;
};
export type AstroNode = {
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
export type AstroImportDeclaration = {
  type?: "ImportDeclaration";
  source?: { value?: unknown; start?: number; end?: number };
  specifiers?: Array<{ type?: string; local?: { name?: string } }>;
};
export type AstroLiteral = { type?: string; value?: unknown; raw?: string };
export type AstroVariableDeclarator = {
  type?: string;
  id?: AstroIdentifier;
  init?: AstroLiteral | { type?: string; value?: unknown } | null;
};
export type AstroVariableDeclaration = {
  type?: "VariableDeclaration";
  kind?: string;
  declarations?: AstroVariableDeclarator[];
};
export type AstroFrontmatterStatement = AstroImportDeclaration | AstroVariableDeclaration;
export type AstroRoot = {
  type?: "AstroRoot";
  frontmatter?: { program?: { body?: AstroFrontmatterStatement[] } };
  body?: AstroNode[];
};

export function getIdentifierName(name?: AstroIdentifier) {
  return name?.type === "JSXIdentifier" ? name.name : undefined;
}

export function isJsxElementNamed(node: AstroNode, name: string) {
  return node.type === "JSXElement" && getIdentifierName(node.openingElement?.name) === name;
}

export function getAttributeName(attribute: AstroAttribute) {
  return getIdentifierName(attribute.name);
}

export function getAttribute(node: AstroNode, name: string) {
  return node.openingElement?.attributes?.find((attribute) => getAttributeName(attribute) === name);
}

export function findAstroRoot(value: unknown): AstroRoot | undefined {
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
