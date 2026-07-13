import { readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

const globalCss = readFileSync(new URL("../runtime/styles/global.css", import.meta.url), "utf8");

test("Core runtime CSS keeps every foundation rule in the base layer", () => {
  const prefix = "@layer theme, base, components, utilities;\n\n@layer base {\n";
  expect(globalCss.startsWith(prefix)).toBe(true);

  const block = globalCss.slice(prefix.length);
  let depth = 1;
  let closingBrace = -1;
  for (let index = 0; index < block.length; index += 1) {
    const character = block[index];
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) {
      closingBrace = index;
      break;
    }
  }

  expect(closingBrace).toBe(block.trimEnd().length - 1);
});
