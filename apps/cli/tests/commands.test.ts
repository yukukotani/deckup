import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import { DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST } from "../src/astro.ts";
import {
  normalizeBuildValues,
  normalizeDevValues,
  normalizeExportValues,
  normalizeLogLevel,
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

test("normalizeDevValues preserves selected deck file and omitted port for config resolution", () => {
  expect(normalizeDevValues({ deckFile: "slides/talk.astro" })).toEqual({
    deckFile: "slides/talk.astro",
    host: DEFAULT_DEV_HOST,
    port: undefined,
    open: false,
    logLevel: "info",
  });
});

test("normalizeDevValues leaves deck validation to the runtime config path", () => {
  expect(normalizeDevValues({}).deckFile).toBeUndefined();
});

test("normalizeBuildValues preserves selected deck file and applies Slida build defaults", () => {
  expect(normalizeBuildValues({ deckFile: "slides/talk.mdx" })).toEqual({
    deckFile: "slides/talk.mdx",
    outDir: DEFAULT_BUILD_OUT_DIR,
    logLevel: "info",
  });
});

test("normalizeExportValues preserves selected deck file and applies Slida export defaults", () => {
  expect(normalizeExportValues({ deckFile: "slides/talk.mdx" })).toEqual({
    deckFile: "slides/talk.mdx",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: undefined,
    force: false,
    logLevel: "info",
  });
});

test("normalizeExportValues keeps PDF target optional and leaves deck validation to runtime", () => {
  expect(normalizeExportValues({}).deckFile).toBeUndefined();
  expect(normalizeExportValues({ out: "talk.pdf" }).out).toBe("talk.pdf");
});

test("normalizeExportValues accepts only boolean force values", () => {
  expect(normalizeExportValues({ force: true }).force).toBe(true);
  expect(normalizeExportValues({ force: "true" }).force).toBe(false);
});
