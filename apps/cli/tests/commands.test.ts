import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import { DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST } from "../src/astro.ts";
import * as commandModule from "../src/commands.ts";
import {
  buildCommand,
  entryCommand,
  normalizeBuildFormat,
  normalizeBuildValues,
  normalizeLogLevel,
  normalizeOpenValues,
  openCommand,
  runSlida,
  VERSION,
} from "../src/commands.ts";

test("VERSION matches the package.json version", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { version: string };
  expect(VERSION).toBe(packageJson.version);
});

test("normalizeLogLevel accepts known Astro log levels", () => {
  expect(normalizeLogLevel("debug")).toBe("debug");
  expect(normalizeLogLevel("silent")).toBe("silent");
});

test("normalizeLogLevel falls back to info", () => {
  expect(normalizeLogLevel("verbose")).toBe("info");
  expect(normalizeLogLevel(undefined)).toBe("info");
});

test("normalizeOpenValues preserves selected deck file and omitted port for config resolution", () => {
  expect(normalizeOpenValues({ deckFile: "slides/talk.astro" })).toEqual({
    deckFile: "slides/talk.astro",
    host: DEFAULT_DEV_HOST,
    port: undefined,
    open: false,
    logLevel: "info",
  });
});

test("normalizeOpenValues leaves deck validation to the runtime config path", () => {
  expect(normalizeOpenValues({}).deckFile).toBeUndefined();
});

test("normalizeBuildFormat accepts supported output formats and defaults to pdf", () => {
  expect(normalizeBuildFormat(undefined)).toBe("pdf");
  expect(normalizeBuildFormat("pdf")).toBe("pdf");
  expect(normalizeBuildFormat("html")).toBe("html");
});

test("normalizeBuildFormat rejects unsupported output formats", () => {
  expect(() => normalizeBuildFormat("pptx")).toThrow(/Unsupported Slida build format/);
});

test("normalizeBuildValues defaults to PDF output and preserves selected deck file", () => {
  expect(normalizeBuildValues({ deckFile: "slides/talk.mdx" })).toEqual({
    deckFile: "slides/talk.mdx",
    format: "pdf",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: undefined,
    force: false,
    logLevel: "info",
  });
});

test("normalizeBuildValues maps html output to the requested output directory", () => {
  expect(
    normalizeBuildValues({ deckFile: "slides/talk.mdx", format: "html", out: "public-deck" }),
  ).toEqual({
    deckFile: "slides/talk.mdx",
    format: "html",
    outDir: "public-deck",
    out: undefined,
    force: false,
    logLevel: "info",
  });
});

test("normalizeBuildValues defaults html output to the deck basename", () => {
  expect(normalizeBuildValues({ deckFile: "slides/talk.mdx", format: "html" })).toEqual({
    deckFile: "slides/talk.mdx",
    format: "html",
    outDir: "talk",
    out: undefined,
    force: false,
    logLevel: "info",
  });
});

test("normalizeBuildValues maps pdf output to the PDF target and force flag", () => {
  expect(
    normalizeBuildValues({
      deckFile: "slides/talk.mdx",
      format: "pdf",
      out: "talk.pdf",
      force: true,
    }),
  ).toEqual({
    deckFile: "slides/talk.mdx",
    format: "pdf",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: "talk.pdf",
    force: true,
    logLevel: "info",
  });
});

test("normalizeBuildValues accepts only boolean force values", () => {
  expect(normalizeBuildValues({ force: true }).force).toBe(true);
  expect(normalizeBuildValues({ force: "true" }).force).toBe(false);
});

test("normalizeBuildValues ignores legacy outDir and keeps PDF staging internal", () => {
  expect(normalizeBuildValues({ format: "pdf", outDir: "custom-dist" }).outDir).toBe(
    DEFAULT_BUILD_OUT_DIR,
  );
});

test("openCommand exposes the renamed preview command", () => {
  expect(openCommand.name).toBe("open");
  expect(openCommand.description).toContain("preview server");
  expect(openCommand.args.deckFile.required).toBe(true);
  expect(openCommand.args.port.short).toBe("p");
});

test("buildCommand exposes unified output format options", () => {
  expect(buildCommand.name).toBe("build");
  expect(buildCommand.description).toContain("PDF");
  expect(buildCommand.args.format.default).toBe("pdf");
  expect(buildCommand.args.out.description).toContain("PDF output file");
  expect(buildCommand.args.force.short).toBe("f");
});

test("legacy command exports are removed", () => {
  expect("devCommand" in commandModule).toBe(false);
  expect("exportCommand" in commandModule).toBe(false);
});

test("entry command advertises open and unified build", async () => {
  expect(entryCommand.name).toBe("slida");
  const output = await runSlida([]);
  expect(output).toContain("slida open <deck-file>");
  expect(output).toContain("slida build <deck-file>");
  expect(output).toContain("--format html");
  expect(output).not.toContain("slida dev");
  expect(output).not.toContain("slida export");
});
