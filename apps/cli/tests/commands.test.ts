import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import { DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST } from "../src/astro.ts";
import * as commandModule from "../src/commands.ts";
import {
  buildCommand,
  entryCommand,
  executeBuildCommand,
  normalizeBuildFormat,
  normalizeBuildValues,
  normalizeLogLevel,
  normalizeOpenValues,
  openCommand,
  runDeckup,
  VERSION,
  type DeckupBuildCommandOperations,
} from "../src/commands.ts";

test("VERSION matches the package.json version", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { version: string };
  expect(VERSION).toBe(packageJson.version);
});

test("CLI prints headerless help exactly once", () => {
  const cliFile = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const output = execFileSync(process.execPath, ["--conditions=development", cliFile, "--help"], {
    encoding: "utf8",
  });

  expect(output.match(/^USAGE:$/gm)).toHaveLength(1);
  expect(output).not.toMatch(/^deckup \(deckup v[^)]+\)$/m);
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
  expect(normalizeBuildFormat("png")).toBe("png");
});

test("normalizeBuildFormat rejects unsupported output formats", () => {
  expect(() => normalizeBuildFormat("pptx")).toThrow(/Unsupported Deckup build format/);
});

test("normalizeBuildValues defaults to PDF output and preserves selected deck file", () => {
  expect(normalizeBuildValues({ deckFile: "slides/talk.mdx" })).toEqual({
    deckFile: "slides/talk.mdx",
    format: "pdf",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: undefined,
    force: false,
    slides: undefined,
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
    slides: undefined,
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
    slides: undefined,
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
    slides: undefined,
    logLevel: "info",
  });
});

test("normalizeBuildValues accepts only boolean force values", () => {
  expect(normalizeBuildValues({ force: true }).force).toBe(true);
  expect(normalizeBuildValues({ force: "true" }).force).toBe(false);
});

test("normalizeBuildValues maps png output, selector, and ignored force to PNG options", () => {
  expect(
    normalizeBuildValues({
      deckFile: "slides/talk.mdx",
      format: "png",
      out: "talk-images",
      slides: "1,3-5",
      force: true,
    }),
  ).toEqual({
    deckFile: "slides/talk.mdx",
    format: "png",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: "talk-images",
    force: true,
    slides: "1,3-5",
    logLevel: "info",
  });
});

test("normalizeBuildValues preserves an explicitly empty PNG selector for strict validation", () => {
  expect(normalizeBuildValues({ format: "png", slides: "" }).slides).toBe("");
});

test("normalizeBuildValues rejects slides for HTML and PDF", () => {
  expect(() => normalizeBuildValues({ format: "html", slides: "1" })).toThrow(
    /only supported with --format png/,
  );
  expect(() => normalizeBuildValues({ format: "pdf", slides: "1" })).toThrow(
    /only supported with --format png/,
  );
});

test("executeBuildCommand returns only ordered absolute PNG paths and ignores force", async () => {
  const pngFiles = [
    join("/tmp", "images", "slide-001.png"),
    join("/tmp", "images", "slide-003.png"),
  ];
  let receivedOptions: unknown;
  const operations = {
    async buildDeck() {
      throw new Error("HTML build should not run");
    },
    async exportDeck() {
      throw new Error("PDF export should not run");
    },
    async assertCanWriteExportTarget() {
      throw new Error("PDF overwrite check should not run");
    },
    async exportDeckPng(options: unknown) {
      receivedOptions = options;
      return {
        outDir: "/tmp/dist",
        htmlFile: "/tmp/dist/index.html",
        pngDir: "/tmp/images",
        pngFiles,
        url: "http://127.0.0.1:4321/",
      };
    },
  } as unknown as DeckupBuildCommandOperations;

  const output = await executeBuildCommand(
    {
      deckFile: "slides/talk.mdx",
      format: "png",
      outDir: DEFAULT_BUILD_OUT_DIR,
      out: "images",
      force: true,
      slides: "1,3",
      logLevel: "debug",
    },
    operations,
  );
  expect(receivedOptions).toEqual({
    deckFile: "slides/talk.mdx",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: "images",
    slides: "1,3",
    logLevel: "silent",
  });
  expect(output).toBe(pngFiles.join("\n"));
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

test("buildCommand exposes PNG output and selector options", () => {
  expect(buildCommand.name).toBe("build");
  expect(buildCommand.description).toContain("PNG");
  expect(buildCommand.args.format.default).toBe("pdf");
  expect(buildCommand.args.format.description).toContain("png");
  expect(buildCommand.args.out.description).toContain("png/html");
  expect(buildCommand.args.slides.description).toContain("1,3-5");
  expect(buildCommand.args.force.short).toBe("f");
  expect(buildCommand.args.logLevel.description).toContain("stdout");
});

test("runDeckup rejects slides outside PNG format before touching the deck", async () => {
  await expect(
    runDeckup(["build", "slides/missing.mdx", "--format", "html", "--slides", "1"]),
  ).rejects.toThrow(/only supported with --format png/);
});

test("legacy command exports are removed", () => {
  expect("devCommand" in commandModule).toBe(false);
  expect("exportCommand" in commandModule).toBe(false);
});

test("entry command advertises open and unified build", async () => {
  expect(entryCommand.name).toBe("deckup");
  const output = await runDeckup([]);
  expect(output).toContain("deckup open <deck-file>");
  expect(output).toContain("deckup build <deck-file>");
  expect(output).toContain("--format html");
  expect(output).toContain("--format png");
  expect(output).not.toContain("deckup dev");
  expect(output).not.toContain("deckup export");
});
