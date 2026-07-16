import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { DeckupResolvedThemeLayout } from "./types.ts";

const descriptionSchema = z.string().trim().min(1);
const layoutMetadataSchema = z.looseObject({
  description: descriptionSchema.optional(),
});
const packageJsonSchema = z.looseObject({
  description: descriptionSchema.optional(),
  deckup: z
    .looseObject({
      layouts: z.record(z.string(), layoutMetadataSchema).optional(),
    })
    .optional(),
});

export type DeckupThemePackageJson = z.output<typeof packageJsonSchema>;

function formatMetadataField(path: PropertyKey[]) {
  return path.length === 0
    ? "package metadata"
    : `package metadata field ${JSON.stringify(path.join("."))}`;
}

function isDescriptionField(path: PropertyKey[]) {
  return (
    (path.length === 1 && path[0] === "description") ||
    (path.length === 4 &&
      path[0] === "deckup" &&
      path[1] === "layouts" &&
      path[3] === "description")
  );
}

function formatMetadataIssue(path: PropertyKey[]) {
  return isDescriptionField(path) ? "must be a non-empty string" : "must be an object";
}

function hasOwnPrototypeLayout(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const deckup = (value as Record<string, unknown>).deckup;
  if (typeof deckup !== "object" || deckup === null) return false;
  const layouts = (deckup as Record<string, unknown>).layouts;
  return typeof layouts === "object" && layouts !== null && Object.hasOwn(layouts, "__proto__");
}

export function parseDeckupThemePackageJson(
  value: unknown,
  context: string,
  filePath: string,
): DeckupThemePackageJson {
  if (hasOwnPrototypeLayout(value)) {
    throw new TypeError(
      `${context} package metadata field "deckup.layouts.__proto__" must not use "__proto__" as a layout id: ${filePath}`,
    );
  }
  const result = packageJsonSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path ?? [];
    throw new TypeError(
      `${context} ${formatMetadataField(path)} ${formatMetadataIssue(path)}: ${filePath}`,
    );
  }
  return result.data;
}

export async function readDeckupThemePackageJson(filePath: string, context: string) {
  let rawPackageJson: string;
  try {
    rawPackageJson = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`${context} package metadata is missing: ${filePath}`, { cause: error });
  }

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(rawPackageJson);
  } catch (error) {
    throw new Error(`${context} package metadata is not valid JSON: ${filePath}`, { cause: error });
  }

  return parseDeckupThemePackageJson(packageJson, context, filePath);
}

export function applyDeckupThemeMetadata(
  themeName: string,
  packageJsonPath: string,
  packageJson: DeckupThemePackageJson,
  layouts: DeckupResolvedThemeLayout[],
) {
  const layoutMetadata = packageJson.deckup?.layouts ?? {};
  const discoveredLayoutIds = new Set(layouts.map((layout) => layout.id));
  for (const layoutId of Object.keys(layoutMetadata)) {
    if (discoveredLayoutIds.has(layoutId)) continue;
    throw new Error(
      `Deckup theme ${JSON.stringify(themeName)} package metadata field ${JSON.stringify(`deckup.layouts.${layoutId}`)} references unknown layout ${JSON.stringify(layoutId)}. Discovered layouts: ${[...discoveredLayoutIds].sort().join(", ")}: ${packageJsonPath}`,
    );
  }

  const enrichedLayouts = layouts.map((layout) => {
    const description = layoutMetadata[layout.id]?.description;
    return description === undefined ? layout : { ...layout, description };
  });

  return {
    ...(packageJson.description === undefined ? {} : { description: packageJson.description }),
    layouts: enrichedLayouts,
  };
}
