import { resolveDeckFile, resolveDeckupThemeLayouts } from "@deckup/core";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, extname } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { cli, define } from "gunshi";
import { renderUsage } from "gunshi/renderer";

import {
  buildDeck,
  DEFAULT_BUILD_OUT_DIR,
  DEFAULT_DEV_HOST,
  exportDeck,
  exportDeckPng,
  normalizeExportOutFile,
  startDevServer,
} from "./astro.ts";
import { pathExists, resolveProjectRoot } from "./runtime.ts";
import type {
  DeckupBuildCommandOptions,
  DeckupDevOptions,
  DeckupDevResult,
  DeckupLogLevel,
  DeckupOutputFormat,
} from "./types.ts";

function readCliVersion() {
  // package.json sits one directory above both src/ (dev) and dist/ (packed).
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  try {
    const packageJson = JSON.parse(readFileSync(fileURLToPath(packageJsonUrl), "utf8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readCliVersion();

const logLevels = [
  "debug",
  "info",
  "warn",
  "error",
  "silent",
] as const satisfies readonly DeckupLogLevel[];

type CommandValues = Record<string, unknown>;

export interface DeckupInspectThemeCommandOptions {
  themeName: string;
  json: boolean;
  root?: string;
}

export interface DeckupThemeInspection {
  theme: string;
  layouts: Array<{ id: string; slots: string[] }>;
}

type ResolvedDeckupTheme = Awaited<ReturnType<typeof resolveDeckupThemeLayouts>>;

const buildOutputFormats = ["html", "pdf", "png"] as const satisfies readonly DeckupOutputFormat[];

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrStringValue(value: unknown) {
  return typeof value === "boolean" || typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeLogLevel(value: unknown): DeckupLogLevel {
  return typeof value === "string" && logLevels.includes(value as DeckupLogLevel)
    ? (value as DeckupLogLevel)
    : "info";
}

export function normalizeBuildFormat(value: unknown): DeckupOutputFormat {
  const format = stringValue(value);
  if (format === undefined) {
    return "pdf";
  }
  if (buildOutputFormats.includes(format as DeckupOutputFormat)) {
    return format as DeckupOutputFormat;
  }
  throw new Error(
    `Unsupported Deckup build format: ${format}. Supported formats: ${buildOutputFormats.join(", ")}.`,
  );
}

function defaultHtmlOutDir(deckFile: string | undefined) {
  if (!deckFile) {
    return DEFAULT_BUILD_OUT_DIR;
  }

  const name = basename(deckFile, extname(deckFile));
  return name.length > 0 ? name : DEFAULT_BUILD_OUT_DIR;
}

export function normalizeOpenValues(values: CommandValues): DeckupDevOptions {
  return {
    deckFile: stringValue(values.deckFile),
    host: booleanOrStringValue(values.host) ?? DEFAULT_DEV_HOST,
    port: numberValue(values.port),
    open: booleanOrStringValue(values.open) ?? false,
    logLevel: normalizeLogLevel(values.logLevel),
  };
}

export function normalizeBuildValues(values: CommandValues): DeckupBuildCommandOptions {
  const format = normalizeBuildFormat(values.format);
  const output = stringValue(values.out);
  const deckFile = stringValue(values.deckFile);
  const slides = optionalStringValue(values.slides);
  if (slides !== undefined && format !== "png") {
    throw new Error("Deckup build --slides is only supported with --format png.");
  }

  return {
    deckFile,
    format,
    outDir: format === "html" ? (output ?? defaultHtmlOutDir(deckFile)) : DEFAULT_BUILD_OUT_DIR,
    out: format === "pdf" || format === "png" ? output : undefined,
    force: booleanValue(values.force) ?? false,
    slides,
    logLevel: normalizeLogLevel(values.logLevel),
  };
}

export function normalizeInspectThemeValues(
  values: CommandValues,
): DeckupInspectThemeCommandOptions {
  const themeName = stringValue(values.themeName);
  if (!themeName) throw new Error("Deckup inspect theme requires a theme name.");
  return { themeName, json: booleanValue(values.json) ?? false };
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectThemeInspection(theme: ResolvedDeckupTheme): DeckupThemeInspection {
  return {
    theme: theme.name,
    layouts: theme.layouts
      .map((layout) => {
        const namedSlots = [...new Set(layout.slotNames)]
          .filter((slotName) => slotName !== "default")
          .sort(compareStrings);
        const hasPublicDefault = layout.hasDefaultSlot || layout.slotNames.includes("default");
        return {
          id: layout.id,
          slots: [...(hasPublicDefault ? ["default"] : []), ...namedSlots],
        };
      })
      .sort((left, right) => compareStrings(left.id, right.id)),
  };
}

function formatThemeInspection(inspection: DeckupThemeInspection) {
  const lines = [`Theme: ${inspection.theme}`];
  for (const layout of inspection.layouts) {
    lines.push(`  Layout: ${layout.id}`);
    if (layout.slots.length === 0) {
      lines.push("    Slots: (none)");
      continue;
    }
    lines.push("    Slots:");
    for (const slot of layout.slots) lines.push(`      - ${slot}`);
  }
  return lines.join("\n");
}

function formatDevUrl(
  address: DeckupDevResult["address"],
  requestedHost: string | boolean | undefined,
) {
  const host =
    typeof requestedHost === "string"
      ? requestedHost
      : address.address === "::" || address.address === "0.0.0.0"
        ? "localhost"
        : address.address;
  return `http://${host}:${address.port}/`;
}

async function resolveExportTarget(options: DeckupBuildCommandOptions) {
  const projectRoot = await realpath(resolveProjectRoot(options.root));
  const deck = await resolveDeckFile(projectRoot, options.deckFile);
  return normalizeExportOutFile(projectRoot, deck, options.out);
}

async function confirmOverwrite(filePath: string) {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(`Overwrite existing PDF at ${filePath}? [y/N] `);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function assertCanWriteExportTarget(options: DeckupBuildCommandOptions) {
  const pdfFile = await resolveExportTarget(options);
  if (!(await pathExists(pdfFile)) || options.force) {
    return;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      `Deckup build PDF already exists: ${pdfFile}. Re-run with --force to overwrite in non-interactive mode.`,
    );
  }

  if (!(await confirmOverwrite(pdfFile))) {
    throw new Error(`Deckup build cancelled. PDF already exists: ${pdfFile}`);
  }
}

/** @internal Test seam; not exported from the package index. */
export interface DeckupBuildCommandOperations {
  buildDeck: typeof buildDeck;
  exportDeck: typeof exportDeck;
  exportDeckPng: typeof exportDeckPng;
  assertCanWriteExportTarget: typeof assertCanWriteExportTarget;
}

const defaultBuildCommandOperations: DeckupBuildCommandOperations = {
  buildDeck,
  exportDeck,
  exportDeckPng,
  assertCanWriteExportTarget,
};

/** @internal Exported for deterministic command-dispatch tests. */
export async function executeBuildCommand(
  options: DeckupBuildCommandOptions,
  operations: DeckupBuildCommandOperations = defaultBuildCommandOperations,
) {
  if (options.format === "html") {
    const { force: _force, format: _format, out: _out, slides: _slides, ...buildOptions } = options;
    await operations.buildDeck(buildOptions);
    return `Deckup HTML deck built at ${buildOptions.outDir ?? DEFAULT_BUILD_OUT_DIR}`;
  }

  if (options.format === "png") {
    const { force: _force, format: _format, ...pngOptions } = options;
    const result = await operations.exportDeckPng({ ...pngOptions, logLevel: "silent" });
    return result.pngFiles.join("\n");
  }

  await operations.assertCanWriteExportTarget(options);
  const { force: _force, format: _format, slides: _slides, ...exportOptions } = options;
  const result = await operations.exportDeck(exportOptions);
  return `Deckup PDF deck built at ${result.pdfFile}`;
}

/** @internal Test seam; not exported from the package index. */
export interface DeckupInspectThemeCommandOperations {
  resolveDeckupThemeLayouts: typeof resolveDeckupThemeLayouts;
  resolveProjectRoot: typeof resolveProjectRoot;
}

const defaultInspectThemeCommandOperations: DeckupInspectThemeCommandOperations = {
  resolveDeckupThemeLayouts,
  resolveProjectRoot,
};

/** @internal Exported for deterministic command-dispatch tests. */
export async function executeInspectThemeCommand(
  options: DeckupInspectThemeCommandOptions,
  operations: DeckupInspectThemeCommandOperations = defaultInspectThemeCommandOperations,
) {
  const projectRoot = operations.resolveProjectRoot(options.root);
  const theme = await operations.resolveDeckupThemeLayouts(projectRoot, options.themeName, {
    sourceMode: "installed",
  });
  const inspection = projectThemeInspection(theme);
  return options.json ? JSON.stringify(inspection) : formatThemeInspection(inspection);
}

export const openCommand = define({
  name: "open",
  description: "Open the Deckup Astro preview server.",
  args: {
    deckFile: {
      type: "positional",
      required: true,
      description: "Deck file to preview (.astro or .mdx).",
    },
    host: {
      type: "string",
      default: DEFAULT_DEV_HOST,
      description: "Host for the Astro dev server.",
    },
    port: {
      type: "number",
      short: "p",
      description: "Port for the Astro dev server.",
    },
    open: {
      type: "boolean",
      default: false,
      description: "Open the browser when the dev server starts.",
    },
    logLevel: { type: "string", default: "info", description: "Astro log level." },
  },
  async run(ctx) {
    const options = normalizeOpenValues(ctx.values as CommandValues);
    const { address } = await startDevServer(options);
    return `Deckup preview server running at ${formatDevUrl(address, options.host)}`;
  },
});

export const buildCommand = define({
  name: "build",
  description: "Build the Deckup deck as PNG images, PDF, or static HTML/assets.",
  args: {
    deckFile: {
      type: "positional",
      required: true,
      description: "Deck file to build (.astro or .mdx).",
    },
    format: {
      type: "string",
      default: "pdf",
      description: "Output format: png, pdf, or html.",
    },
    out: {
      type: "string",
      description: "Output directory for png/html, or PDF output file for pdf.",
    },
    slides: {
      type: "string",
      description: "PNG slide numbers and inclusive ranges, for example 1,3-5.",
    },
    force: {
      type: "boolean",
      short: "f",
      default: false,
      description: "Overwrite an existing PDF without prompting; ignored for html/png.",
    },
    logLevel: {
      type: "string",
      default: "info",
      description: "Astro log level; PNG builds stay silent so stdout contains only image paths.",
    },
  },
  async run(ctx) {
    return executeBuildCommand(normalizeBuildValues(ctx.values as CommandValues));
  },
});

export const inspectThemeCommand = define({
  name: "theme",
  description: "Inspect a Deckup theme's layouts and slots.",
  rendering: { validationErrors: null },
  args: {
    themeName: {
      type: "positional",
      required: true,
      description: "Built-in theme name or installed theme package name.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print only machine-readable JSON.",
    },
  },
  async run(ctx) {
    return executeInspectThemeCommand(normalizeInspectThemeValues(ctx.values as CommandValues));
  },
});

export const inspectCommand = define({
  name: "inspect",
  description: "Inspect Deckup project metadata.",
  subCommands: { theme: inspectThemeCommand },
  async run(ctx) {
    return renderUsage(ctx);
  },
});

export const entryCommand = define({
  name: "deckup",
  description: "Astro-based slide deck tool.",
  run() {
    return "Run `deckup open <deck-file>` to preview slides, or `deckup build <deck-file>` to write a PDF by default. Use `--format html` for a static Web deck or `--format png --slides 1,3-5` for PNG images. Inspect a theme with `deckup inspect theme <theme-name>`.";
  },
});

export async function runDeckup(argv = process.argv.slice(2)) {
  return await cli(argv, entryCommand, {
    name: "deckup",
    version: VERSION,
    renderHeader: null,
    subCommands: {
      open: openCommand,
      build: buildCommand,
      inspect: inspectCommand,
    },
    onAfterCommand(ctx, result) {
      if (result && !ctx.values.help && !ctx.values.version) {
        console.log(result);
      }
    },
  });
}
