import { expect, test } from "vite-plus/test";

import { createDeckLayoutSource } from "../src/deck-layout.ts";

const baseOptions = {
  cssModuleId: "/@fs/core/global.css",
  navigationModuleId: "virtual:deckup/navigation.ts",
};

test("createDeckLayoutSource imports the required Core CSS", () => {
  const source = createDeckLayoutSource(baseOptions);
  expect(source.match(/^import .*\.css";$/gm)).toEqual(['import "/@fs/core/global.css";']);
});

test("createDeckLayoutSource imports additional CSS modules after Core CSS", () => {
  const source = createDeckLayoutSource({
    ...baseOptions,
    additionalCssModuleIds: ["/@fs/project/.deckup/tailwind.css", "virtual:feature.css"],
  });
  expect(source.match(/^import .*\.css";$/gm)).toEqual([
    'import "/@fs/core/global.css";',
    'import "/@fs/project/.deckup/tailwind.css";',
    'import "virtual:feature.css";',
  ]);
});
