import { expect, test } from "vite-plus/test";

import deckup, { type DeckupAstroOptions } from "../src/index.ts";

test("DeckupAstroOptions accepts a string theme selector", () => {
  const options: DeckupAstroOptions = {
    decks: "slides/*.{astro,mdx}",
    theme: "minimal",
  };
  expect(options.theme).toBe("minimal");
});

const validOptions: DeckupAstroOptions = {
  decks: "slides/*.{astro,mdx}",
  theme: "minimal",
};
expect(validOptions.theme).toBe("minimal");

const packageThemeOptions: DeckupAstroOptions = {
  decks: "slides/*.{astro,mdx}",
  theme: "@acme/deckup-layout-theme",
};
expect(packageThemeOptions.theme).toBe("@acme/deckup-layout-theme");

const npmThemeOptions: DeckupAstroOptions = {
  decks: "slides/*.{astro,mdx}",
  theme: "npm:@acme/deckup-theme@1.2.3",
};
expect(npmThemeOptions.theme).toBe("npm:@acme/deckup-theme@1.2.3");

deckup({
  decks: "slides/*.{astro,mdx}",
  // @ts-expect-error Theme option remains a string selector, not a resolved theme object
  theme: { name: "minimal" },
});

expect(typeof deckup).toBe("function");
