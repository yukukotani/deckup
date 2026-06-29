import { expect, test } from "vite-plus/test";

import { DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST, DEFAULT_DEV_PORT } from "../src/astro.ts";
import { normalizeBuildValues, normalizeDevValues, normalizeLogLevel } from "../src/commands.ts";

test("normalizeLogLevel accepts known Astro log levels", () => {
  expect(normalizeLogLevel("debug")).toBe("debug");
  expect(normalizeLogLevel("silent")).toBe("silent");
});

test("normalizeLogLevel falls back to info", () => {
  expect(normalizeLogLevel("verbose")).toBe("info");
  expect(normalizeLogLevel(undefined)).toBe("info");
});

test("normalizeDevValues applies Slida dev defaults", () => {
  expect(normalizeDevValues({})).toEqual({
    root: undefined,
    host: DEFAULT_DEV_HOST,
    port: DEFAULT_DEV_PORT,
    open: false,
    logLevel: "info",
  });
});

test("normalizeBuildValues applies Slida build defaults", () => {
  expect(normalizeBuildValues({})).toEqual({
    root: undefined,
    outDir: DEFAULT_BUILD_OUT_DIR,
    logLevel: "info",
  });
});
