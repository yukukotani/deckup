import { realpath } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { cli, define } from "gunshi";

import {
  buildDeck,
  DEFAULT_BUILD_OUT_DIR,
  DEFAULT_DEV_HOST,
  exportDeck,
  normalizeExportOutFile,
  startDevServer,
} from "./astro.ts";
import { resolveDeckFile } from "./deck.ts";
import { pathExists, resolveProjectRoot } from "./runtime.ts";
import type {
  SlidaBuildOptions,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaExportOptions,
  SlidaLogLevel,
} from "./types.ts";

export const VERSION = "0.0.0";

const logLevels = [
  "debug",
  "info",
  "warn",
  "error",
  "silent",
] as const satisfies readonly SlidaLogLevel[];

type CommandValues = Record<string, unknown>;
type SlidaExportCommandOptions = SlidaExportOptions & { force: boolean };

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

export function normalizeLogLevel(value: unknown): SlidaLogLevel {
  return typeof value === "string" && logLevels.includes(value as SlidaLogLevel)
    ? (value as SlidaLogLevel)
    : "info";
}

export function normalizeDevValues(values: CommandValues): SlidaDevOptions {
  return {
    deckFile: stringValue(values.deckFile),
    host: booleanOrStringValue(values.host) ?? DEFAULT_DEV_HOST,
    port: numberValue(values.port),
    open: booleanOrStringValue(values.open) ?? false,
    logLevel: normalizeLogLevel(values.logLevel),
  };
}

export function normalizeBuildValues(values: CommandValues): SlidaBuildOptions {
  return {
    deckFile: stringValue(values.deckFile),
    outDir: stringValue(values.outDir) ?? DEFAULT_BUILD_OUT_DIR,
    logLevel: normalizeLogLevel(values.logLevel),
  };
}

export function normalizeExportValues(values: CommandValues): SlidaExportCommandOptions {
  return {
    deckFile: stringValue(values.deckFile),
    outDir: stringValue(values.outDir) ?? DEFAULT_BUILD_OUT_DIR,
    out: stringValue(values.out),
    force: booleanValue(values.force) ?? false,
    logLevel: normalizeLogLevel(values.logLevel),
  };
}

function formatDevUrl(
  address: SlidaDevResult["address"],
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

async function resolveExportTarget(options: SlidaExportCommandOptions) {
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

async function assertCanWriteExportTarget(options: SlidaExportCommandOptions) {
  const pdfFile = await resolveExportTarget(options);
  if (!(await pathExists(pdfFile)) || options.force) {
    return;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      `Slida export PDF already exists: ${pdfFile}. Re-run with --force to overwrite in non-interactive mode.`,
    );
  }

  if (!(await confirmOverwrite(pdfFile))) {
    throw new Error(`Slida export cancelled. PDF already exists: ${pdfFile}`);
  }
}

export const devCommand = define({
  name: "dev",
  description: "Start the Slida Astro preview server.",
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
    const options = normalizeDevValues(ctx.values as CommandValues);
    const { address } = await startDevServer(options);
    return `Slida dev server running at ${formatDevUrl(address, options.host)}`;
  },
});

export const buildCommand = define({
  name: "build",
  description: "Build the Slida deck as static HTML/assets.",
  args: {
    deckFile: {
      type: "positional",
      required: true,
      description: "Deck file to build (.astro or .mdx).",
    },
    outDir: {
      type: "string",
      default: DEFAULT_BUILD_OUT_DIR,
      description: "Static output directory.",
    },
    logLevel: { type: "string", default: "info", description: "Astro log level." },
  },
  async run(ctx) {
    const options = normalizeBuildValues(ctx.values as CommandValues);
    await buildDeck(options);
    return `Slida deck built at ${options.outDir ?? DEFAULT_BUILD_OUT_DIR}`;
  },
});

export const exportCommand = define({
  name: "export",
  description: "Export the Slida deck to PDF.",
  args: {
    deckFile: {
      type: "positional",
      required: true,
      description: "Deck file to export (.astro or .mdx).",
    },
    out: {
      type: "string",
      description: "PDF output file. Defaults to the deck basename with .pdf.",
    },
    outDir: {
      type: "string",
      default: DEFAULT_BUILD_OUT_DIR,
      description: "Static build output directory used before PDF export.",
    },
    force: {
      type: "boolean",
      short: "f",
      default: false,
      description: "Overwrite an existing PDF without prompting.",
    },
    logLevel: { type: "string", default: "info", description: "Astro log level." },
  },
  async run(ctx) {
    const options = normalizeExportValues(ctx.values as CommandValues);
    await assertCanWriteExportTarget(options);
    const { force: _force, ...exportOptions } = options;
    const result = await exportDeck(exportOptions);
    return `Slida deck exported at ${result.pdfFile}`;
  },
});

export const entryCommand = define({
  name: "slida",
  description: "Astro-based slide deck tool.",
  run() {
    return "Run `slida dev <deck-file>` to preview slides, `slida build <deck-file>` to create a static Web deck, or `slida export <deck-file>` to write a PDF.";
  },
});

export async function runSlida(argv = process.argv.slice(2)) {
  return await cli(argv, entryCommand, {
    name: "slida",
    version: VERSION,
    subCommands: {
      dev: devCommand,
      build: buildCommand,
      export: exportCommand,
    },
  });
}
