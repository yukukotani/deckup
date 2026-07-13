import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, test } from "vite-plus/test";

const require = createRequire(import.meta.url);
const astroGlobalCss = readFileSync(
  new URL("../runtime/styles/global.css", import.meta.url),
  "utf8",
);
const coreGlobalCss = readFileSync(
  require.resolve("@deckup/core/runtime/styles/global.css"),
  "utf8",
);

test("Astro and Core runtime CSS keep the same layer contract", () => {
  expect(astroGlobalCss).toBe(coreGlobalCss);
});
