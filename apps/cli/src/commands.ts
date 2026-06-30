import { cli, define } from "gunshi";

import { buildDeck, DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST, startDevServer } from "./astro.ts";
import type { SlidaBuildOptions, SlidaDevOptions, SlidaDevResult, SlidaLogLevel } from "./types.ts";

export const VERSION = "0.0.0";

const logLevels = [
  "debug",
  "info",
  "warn",
  "error",
  "silent",
] as const satisfies readonly SlidaLogLevel[];

type CommandValues = Record<string, unknown>;

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrStringValue(value: unknown) {
  return typeof value === "boolean" || typeof value === "string" ? value : undefined;
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

export const entryCommand = define({
  name: "slida",
  description: "Astro-based slide deck tool.",
  run() {
    return "Run `slida dev <deck-file>` to preview slides or `slida build <deck-file>` to create a static Web deck.";
  },
});

export async function runSlida(argv = process.argv.slice(2)) {
  return await cli(argv, entryCommand, {
    name: "slida",
    version: VERSION,
    subCommands: {
      dev: devCommand,
      build: buildCommand,
    },
  });
}
