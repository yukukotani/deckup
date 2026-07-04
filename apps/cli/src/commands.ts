import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { basename, extname } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

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
  SlidaBuildCommandOptions,
  SlidaDevOptions,
  SlidaDevResult,
  SlidaLogLevel,
  SlidaOutputFormat,
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
] as const satisfies readonly SlidaLogLevel[];

type CommandValues = Record<string, unknown>;

const buildOutputFormats = ["html", "pdf"] as const satisfies readonly SlidaOutputFormat[];

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

export function normalizeBuildFormat(value: unknown): SlidaOutputFormat {
  const format = stringValue(value);
  if (format === undefined) {
    return "pdf";
  }
  if (buildOutputFormats.includes(format as SlidaOutputFormat)) {
    return format as SlidaOutputFormat;
  }
  throw new Error(
    `Unsupported Slida build format: ${format}. Supported formats: ${buildOutputFormats.join(", ")}.`,
  );
}

function defaultHtmlOutDir(deckFile: string | undefined) {
  if (!deckFile) {
    return DEFAULT_BUILD_OUT_DIR;
  }

  const name = basename(deckFile, extname(deckFile));
  return name.length > 0 ? name : DEFAULT_BUILD_OUT_DIR;
}

export function normalizeOpenValues(values: CommandValues): SlidaDevOptions {
  return {
    deckFile: stringValue(values.deckFile),
    host: booleanOrStringValue(values.host) ?? DEFAULT_DEV_HOST,
    port: numberValue(values.port),
    open: booleanOrStringValue(values.open) ?? false,
    logLevel: normalizeLogLevel(values.logLevel),
  };
}

export function normalizeBuildValues(values: CommandValues): SlidaBuildCommandOptions {
  const format = normalizeBuildFormat(values.format);
  const output = stringValue(values.out);
  const deckFile = stringValue(values.deckFile);

  return {
    deckFile,
    format,
    outDir: format === "html" ? (output ?? defaultHtmlOutDir(deckFile)) : DEFAULT_BUILD_OUT_DIR,
    out: format === "pdf" ? output : undefined,
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

async function resolveExportTarget(options: SlidaBuildCommandOptions) {
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

async function assertCanWriteExportTarget(options: SlidaBuildCommandOptions) {
  const pdfFile = await resolveExportTarget(options);
  if (!(await pathExists(pdfFile)) || options.force) {
    return;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      `Slida build PDF already exists: ${pdfFile}. Re-run with --force to overwrite in non-interactive mode.`,
    );
  }

  if (!(await confirmOverwrite(pdfFile))) {
    throw new Error(`Slida build cancelled. PDF already exists: ${pdfFile}`);
  }
}

export const openCommand = define({
  name: "open",
  description: "Open the Slida Astro preview server.",
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
    return `Slida preview server running at ${formatDevUrl(address, options.host)}`;
  },
});

export const buildCommand = define({
  name: "build",
  description: "Build the Slida deck as PDF or static HTML/assets.",
  args: {
    deckFile: {
      type: "positional",
      required: true,
      description: "Deck file to build (.astro or .mdx).",
    },
    format: {
      type: "string",
      default: "pdf",
      description: "Output format: pdf or html.",
    },
    out: {
      type: "string",
      description: "Output directory for html, or PDF output file for pdf.",
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
    const options = normalizeBuildValues(ctx.values as CommandValues);

    if (options.format === "html") {
      const { force: _force, format: _format, out: _out, ...buildOptions } = options;
      await buildDeck(buildOptions);
      return `Slida HTML deck built at ${buildOptions.outDir ?? DEFAULT_BUILD_OUT_DIR}`;
    }

    await assertCanWriteExportTarget(options);
    const { force: _force, format: _format, ...exportOptions } = options;
    const result = await exportDeck(exportOptions);
    return `Slida PDF deck built at ${result.pdfFile}`;
  },
});

export const entryCommand = define({
  name: "slida",
  description: "Astro-based slide deck tool.",
  run() {
    return "Run `slida open <deck-file>` to preview slides, or `slida build <deck-file>` to write a PDF by default. Use `slida build <deck-file> --format html` for a static Web deck.";
  },
});

export async function runSlida(argv = process.argv.slice(2)) {
  return await cli(argv, entryCommand, {
    name: "slida",
    version: VERSION,
    subCommands: {
      open: openCommand,
      build: buildCommand,
    },
  });
}
