import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import {
  buildDeck,
  createAstroInlineConfig,
  DEFAULT_BUILD_OUT_DIR,
  normalizeBuildOutDir,
} from "../src/astro.ts";
import { prepareRuntime, resolveProjectRoot, resolveRuntimeSourceDir } from "../src/runtime.ts";

const cliPackageRoot = fileURLToPath(new URL("..", import.meta.url));

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-astro-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function linkCliPackage(projectRoot: string) {
  const scopeDir = join(projectRoot, "node_modules", "@slida");
  await mkdir(scopeDir, { recursive: true });
  await symlink(cliPackageRoot, join(scopeDir, "cli"), "dir");
}

function slideCount(html: string) {
  return html.match(/data-slida-slide(?=[\s=>])/g)?.length ?? 0;
}

function layoutCount(html: string, layout: string) {
  return html.match(new RegExp(`data-slida-layout="${layout}"`, "g"))?.length ?? 0;
}

function slideSectionCount(html: string) {
  return html.match(/<section\b[^>]*data-slida-slide/g)?.length ?? 0;
}

function extractInlineCss(html: string) {
  return Array.from(html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g), (match) => match[1]);
}

async function readBuiltCss(projectRoot: string, html: string) {
  const cssParts = extractInlineCss(html);
  const assetsDir = join(projectRoot, "dist", "_astro");

  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });
    const cssFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".css"));
    cssParts.push(
      ...(await Promise.all(
        cssFiles.map((entry) => readFile(join(assetsDir, entry.name), "utf8")),
      )),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return cssParts.join("\n");
}

const builtInViewerThemes = ["default", "minimal", "bold", "google-basic"] as const;

async function writeThemeLayoutPackage(projectRoot: string, packageName: string) {
  const packageDir = join(projectRoot, "node_modules", ...packageName.split("/"));
  const layoutsDir = join(packageDir, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: { "./layouts/*.astro": "./layouts/*.astro", "./package.json": "./package.json" },
    }),
  );
  await writeFile(
    join(layoutsDir, "cover.astro"),
    `<article class="fixture-cover"><slot /></article>\n`,
  );
  await writeFile(
    join(layoutsDir, "default.astro"),
    `<article class="fixture-default"><slot /></article>\n`,
  );
  await writeFile(
    join(layoutsDir, "two-column.astro"),
    `<article class="fixture-two-column"><header data-slot="default"><slot /></header><section data-slot="left"><slot name="left" /></section><section data-slot="right"><slot name="right" /></section></article>\n`,
  );
}

async function writeLayoutThemeConfig(projectRoot: string) {
  await writeThemeLayoutPackage(projectRoot, "@acme/slida-layout-theme");
  await writeFile(
    join(projectRoot, "slida.config.ts"),
    "export default { theme: '@acme/slida-layout-theme' };\n",
  );
}

test("resolveProjectRoot returns an absolute project root", () => {
  expect(resolveProjectRoot(".")).toBe(process.cwd());
});

test("resolveRuntimeSourceDir points at the package runtime directory", () => {
  expect(resolveRuntimeSourceDir()).toBe(fileURLToPath(new URL("../runtime", import.meta.url)));
});

test("normalizeBuildOutDir resolves the default output under the project root", () => {
  const root = resolve("/tmp/slida-project");
  expect(normalizeBuildOutDir(root)).toBe(join(root, DEFAULT_BUILD_OUT_DIR));
});

test("createAstroInlineConfig disables external config and wires runtime dirs", () => {
  const root = resolve("/tmp/slida-project");
  const config = createAstroInlineConfig(
    {
      projectRoot: root,
      runtimeSourceDir: join(root, "node_modules/@slida/cli/runtime"),
      runtimeOutDir: join(root, ".slida/runtime"),
    },
    { outDir: "public-deck", logLevel: "warn" },
  );

  expect(config.root).toBe(root);
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBe(join(root, ".slida/runtime"));
  expect(config.outDir).toBe(join(root, "public-deck"));
  expect(config.logLevel).toBe("warn");
});

test("prepareRuntime writes a fallback page when the selected runtime source is absent", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-runtime-"));
  try {
    const missingRuntimeSource = join(projectRoot, "missing-runtime");
    const paths = await prepareRuntime(projectRoot, missingRuntimeSource);
    const fallback = await readFile(join(paths.runtimeOutDir, "pages/index.astro"), "utf8");
    expect(paths.runtimeSourceDir).toBe(missingRuntimeSource);
    expect(fallback).toContain("Slida runtime unavailable");
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});

test("buildDeck builds one selected Astro deck file", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Intro"><layout id="cover" /><h1>Intro</h1></Page>
<Page title="Details"><h1>Details</h1></Page>
`,
    );
    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });
    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(2);
    expect(html.match(/data-slida-layout="cover"/g)?.length ?? 0).toBe(1);
    expect(html.match(/data-slida-layout="default"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('data-slide-count="2"');
    expect(html).toContain("Intro");
    expect(html).toContain("Details");
    expect(html).not.toContain("<layout");
  });
});

test("buildDeck renders Astro pages through theme layouts and named slots", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeLayoutThemeConfig(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Columns"><layout id="two-column" /><h1>Column title</h1><div slot="left">Left content</div><div slot="right">Right content</div></Page>
<Page title="Default"><p>Default content</p></Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(2);
    expect(slideSectionCount(html)).toBe(2);
    expect(html).toContain('class="slida-slide"');
    expect(html).toContain("data-slida-slide");
    expect(html).toContain('data-slide-count="2"');
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(layoutCount(html, "default")).toBe(1);
    expect(html).toContain('aria-label="Columns"');
    expect(html).toContain('class="fixture-two-column"');
    expect(html).toContain('data-slot="default"');
    expect(html).toContain("Column title");
    expect(html).toContain('data-slot="left"');
    expect(html).toContain("Left content");
    expect(html).toContain('data-slot="right"');
    expect(html).toContain("Right content");
    expect(html).toContain('class="fixture-default"');
    expect(html).toContain("Default content");
    expect(html).not.toContain("<layout");
  });
});

async function expectAstroDeckError(deckSource: string, matcher: RegExp) {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(join(projectRoot, "slides", "bad.astro"), deckSource);
    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.astro", logLevel: "silent" }),
    ).rejects.toThrow(matcher);
  });
}

test("buildDeck rejects a missing deck file option", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(buildDeck({ root: projectRoot, logLevel: "silent" })).rejects.toThrow(
      /Missing Slida deck file/,
    );
  });
});

test("buildDeck rejects Astro deck top-level content outside Page", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "bad.astro"),
      `---
import Page from "@slida/cli/page";
---

<h1>Loose content</h1>
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.astro", logLevel: "silent" }),
    ).rejects.toThrow(/top-level content must be <Page>/);
  });
});

test("buildDeck rejects Astro decks without the package Page import", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "bad.astro"),
      `---
---

<Page title="Intro"><h1>Intro</h1></Page>
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.astro", logLevel: "silent" }),
    ).rejects.toThrow(/import Page from/);
  });
});

test("buildDeck rejects duplicate Astro layout declarations", async () => {
  await expectAstroDeckError(
    `---
import Page from "@slida/cli/page";
---

<Page><layout id="cover" /><layout id="default" /><h1>Intro</h1></Page>
`,
    /multiple layout declarations/,
  );
});

test("buildDeck rejects Astro layout declarations without id", async () => {
  await expectAstroDeckError(
    `---
import Page from "@slida/cli/page";
---

<Page><layout /><h1>Intro</h1></Page>
`,
    /must include an id attribute/,
  );
});

test("buildDeck rejects empty Astro layout ids", async () => {
  await expectAstroDeckError(
    `---
import Page from "@slida/cli/page";
---

<Page><layout id="" /><h1>Intro</h1></Page>
`,
    /Invalid Slida layout id/,
  );
});

test("buildDeck rejects invalid Astro layout ids", async () => {
  await expectAstroDeckError(
    `---
import Page from "@slida/cli/page";
---

<Page><layout id="Cover Slide" /><h1>Intro</h1></Page>
`,
    /Invalid Slida layout id/,
  );
});

test("buildDeck rejects Astro decks that select a missing theme layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeLayoutThemeConfig(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "bad.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page><layout id="missing" /><h1>Missing</h1></Page>
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.astro", logLevel: "silent" }),
    ).rejects.toThrow(/does not provide layout "missing"/);
  });
});

test("buildDeck renders Astro pages through the Google Basic two-column layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default { theme: 'google-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Google Columns"><layout id="two-column" /><h1>Google title</h1><p slot="left">Google left</p><p slot="right">Google right</p></Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideSectionCount(html)).toBe(1);
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(html).toContain("Google title");
    expect(html).toContain('class="slida-google-column slida-google-column--left"');
    expect(html).toContain("Google left");
    expect(html).toContain('class="slida-google-column slida-google-column--right"');
    expect(html).toContain("Google right");
  });
});

for (const theme of builtInViewerThemes) {
  test(`buildDeck emits fixed 16:9 viewer CSS for ${theme}`, async () => {
    await withProjectRoot(async (projectRoot) => {
      await linkCliPackage(projectRoot);
      await writeFile(
        join(projectRoot, "slida.config.ts"),
        `export default { theme: '${theme}' };\n`,
      );
      await mkdir(join(projectRoot, "slides"));
      await writeFile(
        join(projectRoot, "slides", "deck.astro"),
        `---
import Page from "@slida/cli/page";
---

<Page title="Intro"><layout id="cover" /><h1>Intro</h1><p>Body</p></Page>
`,
      );

      await buildDeck({
        root: projectRoot,
        deckFile: "slides/deck.astro",
        outDir: "dist",
        logLevel: "silent",
      });

      const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
      const css = await readBuiltCss(projectRoot, html);

      expect(slideSectionCount(html)).toBe(1);
      expect(layoutCount(html, "cover")).toBe(1);
      expect(html).toContain('data-slide-count="1"');
      expect(css).toMatch(
        /body\{(?=[^}]*display:grid)(?=[^}]*place-items:center)(?=[^}]*background:#111)[^}]*\}/,
      );
      expect(css).toMatch(/\.slida-shell\{[^}]*aspect-ratio:16\/9/);
      expect(css).toContain("container-type:size");
      expect(css).toMatch(
        /\.slida-deck,\.slida-empty\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0/,
      );
      expect(css).toMatch(/\.slida-slide\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0/);
      expect(css).not.toMatch(/\.slida-status\{display:none!important\}/);

      if (theme !== "google-basic") {
        expect(css).not.toMatch(/body\{[^}]*background:var\(--slida-bg\)/);
        expect(css).toContain("--slida-cqw:1cqw");
        expect(css).toContain("var(--slida-cqw)");
        expect(css).not.toContain("6vw");
        expect(css).not.toContain("9vw");
      }
    });
  });
}

test("buildDeck builds one selected MDX deck file split by dividers", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: MDX Deck
---

<layout id="cover" />

# Intro

---

# Details
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(2);
    expect(layoutCount(html, "cover")).toBe(1);
    expect(layoutCount(html, "default")).toBe(1);
    expect(html).toContain('data-slide-count="2"');
    expect(html).toContain("MDX Deck");
    expect(html).toContain("Intro");
    expect(html).toContain("Details");
    expect(html).not.toContain("<layout");
  });
});

test("buildDeck renders MDX pages through theme layouts and named slots", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeLayoutThemeConfig(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: MDX Layout Deck
---

<layout id="two-column" />

# MDX Column title

<div slot="left">MDX left content</div>

<div slot="right">MDX right content</div>

---

# MDX default content
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(2);
    expect(slideSectionCount(html)).toBe(2);
    expect(html).toContain('data-slide-count="2"');
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(layoutCount(html, "default")).toBe(1);
    expect(html).toContain('class="fixture-two-column"');
    expect(html).toContain("MDX Column title");
    expect(html).toContain("MDX left content");
    expect(html).toContain("MDX right content");
    expect(html).toContain('class="fixture-default"');
    expect(html).toContain("MDX default content");
    expect(html).not.toContain("<layout");
  });
});

test("buildDeck renders MDX pages through the Google Basic two-column layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default { theme: 'google-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: Google Basic MDX
---

<layout id="two-column" />

# Google MDX title

<p slot="left">Google MDX left</p>

<p slot="right">Google MDX right</p>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideSectionCount(html)).toBe(1);
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(html).toContain("Google MDX title");
    expect(html).toContain('class="slida-google-column slida-google-column--left"');
    expect(html).toContain("Google MDX left");
    expect(html).toContain('class="slida-google-column slida-google-column--right"');
    expect(html).toContain("Google MDX right");
    expect(html).not.toContain("<layout");
  });
});

test("buildDeck rejects MDX decks that select a missing theme layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeLayoutThemeConfig(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "bad.mdx"),
      `---
title: Missing
---

<layout id="missing" />

# Missing
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.mdx", logLevel: "silent" }),
    ).rejects.toThrow(/does not provide layout "missing"/);
  });
});
