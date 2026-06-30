import { expect, test } from "vite-plus/test";

import { DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST } from "../src/astro.ts";
import { normalizeBuildValues, normalizeDevValues, normalizeLogLevel } from "../src/commands.ts";

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
