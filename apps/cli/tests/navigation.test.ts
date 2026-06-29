import { expect, test } from "vite-plus/test";

import {
  clampSlideIndex,
  formatSlideHash,
  getNextSlideIndex,
  parseSlideHash,
} from "../runtime/scripts/navigation.ts";

test("parseSlideHash reads numeric and slide-prefixed hashes", () => {
  expect(parseSlideHash("#1", 3)).toBe(0);
  expect(parseSlideHash("#/2", 3)).toBe(1);
  expect(parseSlideHash("#slide-3", 3)).toBe(2);
});

test("parseSlideHash falls back or clamps invalid hashes", () => {
  expect(parseSlideHash("", 3)).toBe(0);
  expect(parseSlideHash("#wat", 3)).toBe(0);
  expect(parseSlideHash("#99", 3)).toBe(2);
});

test("getNextSlideIndex keeps navigation within bounds", () => {
  expect(getNextSlideIndex(0, -1, 3)).toBe(0);
  expect(getNextSlideIndex(0, 1, 3)).toBe(1);
  expect(getNextSlideIndex(2, 1, 3)).toBe(2);
});

test("formatSlideHash uses one-based slide numbers", () => {
  expect(formatSlideHash(0)).toBe("#1");
  expect(formatSlideHash(2)).toBe("#3");
});

test("clampSlideIndex handles empty decks", () => {
  expect(clampSlideIndex(5, 0)).toBe(0);
});
