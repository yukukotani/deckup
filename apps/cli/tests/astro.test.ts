import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import {
  buildDeck,
  createAstroInlineConfig,
  DEFAULT_BUILD_OUT_DIR,
  exportDeck,
  normalizeBuildOutDir,
  normalizeExportOutFile,
} from "../src/astro.ts";
import {
  pathExists,
  prepareRuntime,
  resolveProjectRoot,
  resolveRuntimeSourceDir,
} from "../src/runtime.ts";

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

async function localBrowserExecutablePath() {
  const candidates = [
    process.env.SLIDA_CHROMIUM_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
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

async function readBuiltCss(projectRoot: string, html: string, outDir = "dist") {
  const cssParts = extractInlineCss(html);
  const assetsDir = join(projectRoot, outDir, "_astro");

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

const builtInViewerThemes = ["default", "minimal", "bold", "google-basic", "apple-basic"] as const;

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

test("normalizeExportOutFile resolves the default PDF output from the selected deck basename", () => {
  const root = resolve("/tmp/slida-project");
  expect(
    normalizeExportOutFile(root, {
      filePath: join(root, "slides", "talk.astro"),
      projectRelativePath: "slides/talk.astro",
      format: "astro",
    }),
  ).toBe(join(root, "talk.pdf"));
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

test("buildDeck highlights MDX fenced code blocks by default", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: Highlighted MDX
---

# Code

\`\`\`ts
const slide = { title: "MDX" };
\`\`\`
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(1);
    expect(html).toContain('class="astro-code');
    expect(html).toContain('data-language="ts"');
    expect(html).toContain('style="');
    expect(html).toContain("MDX");
  });
});

test("buildDeck highlights static Astro pre code blocks", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Astro Code">
  <pre><code class="language-ts">const slide = { title: "Astro" };</code></pre>
  <pre><code class="language-html">&lt;section data-title="Astro"&gt;safe&lt;/section&gt;</code></pre>
</Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(1);
    expect(layoutCount(html, "cover")).toBe(1);
    expect(html).toContain('class="astro-code');
    expect(html).toContain('data-language="ts"');
    expect(html).toContain('data-language="html"');
    expect(html).toContain('style="');
    expect(html).toContain("<span");
    expect(html).toContain("Astro");
    // Shiki tokenizes the escaped HTML source; this is the rendered-safe form of &lt;section.
    expect(html).toContain("&#x3C;");
    expect(html).not.toContain('<pre><code class="language-ts">');
  });
});

test("buildDeck uses astro markdown theme for static Astro code blocks", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      `export default {
  astro: {
    markdown: {
      shikiConfig: {
        theme: 'github-light',
      },
    },
  },
};
`,
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Theme"><pre><code class="language-ts">const theme = "light";</code></pre></Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(html).toContain('class="astro-code');
    expect(html).toContain("github-light");
    expect(html).toContain('data-language="ts"');
  });
});

test("buildDeck leaves dynamic Astro code blocks unchanged", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
const language = "language-ts";
---

<Page title="Dynamic">
  <pre><code class={language}>const slide = { title: "Dynamic" };</code></pre>
</Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain("Dynamic");
    expect(html).not.toContain('class="astro-code');
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

test("buildDeck renders Astro pages through the Google Basic flow layouts", async () => {
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

<Page title="Google Page"><layout id="page" /><h1>Google page title</h1><p>Google page body</p><ul><li>Google bullet</li></ul><p>Google follow-up</p></Page>
<Page title="Google Columns"><layout id="two-column" /><h1>Google column title</h1><p slot="left">Google left</p><p slot="right">Google right</p></Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideSectionCount(html)).toBe(2);
    expect(layoutCount(html, "page")).toBe(1);
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(html).toContain("Google page title");
    expect(html).toContain("Google page body");
    expect(html).toContain("Google bullet");
    expect(html).toContain("Google follow-up");
    expect(html).toContain("Google column title");
    expect(html).toContain('class="slida-google-column slida-google-column--left"');
    expect(html).toContain("Google left");
    expect(html).toContain('class="slida-google-column slida-google-column--right"');
    expect(html).toContain("Google right");
    expect(html).not.toContain("<layout");
  });
});

test("buildDeck renders Astro pages through the Apple Basic flow layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default { theme: 'apple-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Apple Page"><layout id="page" /><h1>Apple page title</h1><p>Apple page subtitle</p><p>Apple page body</p><ul><li>Apple bullet</li></ul></Page>
<Page title="Apple Columns"><layout id="two-column" /><h1>Apple column title</h1><p slot="left">Apple left</p><p slot="right">Apple right</p></Page>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideSectionCount(html)).toBe(2);
    expect(layoutCount(html, "page")).toBe(1);
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(html).toContain("Apple page title");
    expect(html).toContain("Apple page subtitle");
    expect(html).toContain("Apple page body");
    expect(html).toContain("Apple bullet");
    expect(html).toContain("Apple column title");
    expect(html).toContain('class="slida-apple-column slida-apple-column--left"');
    expect(html).toContain("Apple left");
    expect(html).toContain('class="slida-apple-column slida-apple-column--right"');
    expect(html).toContain("Apple right");
    expect(html).not.toContain("<layout");
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
      expect(html).toContain("data-slida-navigation");
      expect(html).toContain("data-slida-nav-drag-handle");
      expect(html).toContain("data-slida-nav-prev");
      expect(html).toContain("data-slida-nav-next");
      expect(html).toContain("data-slida-current");
      expect(html).toContain("data-slida-total");
      expect(html).toContain('aria-label="Slide navigation"');
      expect(html).toContain('aria-label="Move navigation menu"');
      expect(html).toContain('aria-label="Previous slide"');
      expect(html).toContain('aria-label="Next slide"');
      expect(css).toMatch(
        /body\{(?=[^}]*display:grid)(?=[^}]*place-items:center)(?=[^}]*background:#111)[^}]*\}/,
      );
      expect(css).toMatch(/\.slida-shell\{[^}]*aspect-ratio:16\/9/);
      expect(css).toContain("container-type:size");
      expect(css).toMatch(
        /\.slida-deck,\.slida-empty\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0/,
      );
      expect(css).toMatch(/\.slida-slide\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0/);
      expect(css).toMatch(
        /\.slida-status\{(?=[^}]*position:fixed)(?=[^}]*display:inline-flex)[^}]*\}/,
      );
      expect(css).toContain(".slida-navigation__button");
      expect(css).toContain(".slida-navigation__handle");
      expect(css).toMatch(/\.slida-navigation__handle\{[^}]*touch-action:none/);
      expect(css).toMatch(
        /\.slida-navigation__button:not\(:disabled\),\.slida-navigation__handle\{[^}]*cursor:pointer/,
      );
      expect(css).toMatch(
        /\.slida-navigation__button:not\(:disabled\):hover,[^}]*\.slida-navigation__handle:focus-visible\{[^}]*background:/,
      );
      expect(css).toMatch(/\.slida-navigation__button:disabled\{[^}]*opacity:/);
      expect(css).not.toMatch(/\.slida-status\{display:none!important\}/);
      expect(css).not.toMatch(/\.slida-navigation\{display:none!important\}/);

      expect(css).not.toMatch(/body\{[^}]*background:var\(--slida-bg\)/);
      expect(css).toContain("--slida-cqw:1cqw");
      expect(css).toContain("var(--slida-cqw)");
      expect(css).not.toContain("6vw");
      expect(css).not.toContain("9vw");

      if (theme === "google-basic" || theme === "apple-basic") {
        expect(css).not.toMatch(/\[data-slida-layout\]>:is\(h1,p,ul,ol\)\{[^}]*position:absolute/);
        expect(css).not.toMatch(
          /\[data-slida-layout=(?:"page"|page|"two-column"|two-column)\]>[^{}]*(?:first-of-type|nth-of-type)[^{]*\{(?=[^}]*(?:top|left):)[^}]*\}/,
        );
        expect(css).not.toMatch(
          /[^{}]*\.slida-(?:google|apple)-column[^{}]*\{[^}]*position:absolute/,
        );
      }
    });
  });
}

for (const theme of ["google-basic", "apple-basic"] as const) {
  test(`buildDeck renders ${theme} non-page flow layouts`, async () => {
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

<Page title="Cover"><layout id="cover" /><h1>Cover title</h1><p>Cover subtitle</p></Page>
<Page title="Section"><layout id="section" /><h1>Section title</h1></Page>
<Page title="Number"><layout id="number" /><p>42</p><p>Number caption</p></Page>
<Page title="Quote"><layout id="quote" /><p>Quote body</p><p>Quote name</p></Page>
<Page title="Statement"><layout id="statement" /><p>Statement body</p></Page>
`,
      );

      await buildDeck({
        root: projectRoot,
        deckFile: "slides/deck.astro",
        outDir: "dist",
        logLevel: "silent",
      });

      const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
      expect(slideSectionCount(html)).toBe(5);
      expect(layoutCount(html, "cover")).toBe(1);
      expect(layoutCount(html, "section")).toBe(1);
      expect(layoutCount(html, "number")).toBe(1);
      expect(layoutCount(html, "quote")).toBe(1);
      expect(layoutCount(html, "statement")).toBe(1);
      expect(html).toContain("Cover title");
      expect(html).toContain("Section title");
      expect(html).toContain("42");
      expect(html).toContain("Quote body");
      expect(html).toContain("Statement body");
      expect(html).not.toContain("<layout");
    });
  });
}

test("buildDeck emits print CSS that reveals slides and hides navigation for PDF output", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
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
    const css = await readBuiltCss(projectRoot, html);

    expect(css).toContain("@media print");
    expect(css).toContain("@page");
    expect(css).toContain("[data-slida-navigation]");
    expect(css).toMatch(/break-after:page|page-break-after:always/);
    expect(css).toMatch(/@page\{size:16in 9in;margin:0\}/);
    expect(css).toMatch(
      /\.slida-slide,\.slida-slide\[hidden\],\.slida-slide:not\(:first-child\):not\(\[data-active\]\)\{(?=[^}]*height:100vh)(?=[^}]*overflow:hidden)[^}]*\}/,
    );
    expect(css).not.toMatch(
      /\.slida-slide,\.slida-slide\[hidden\],\.slida-slide:not\(:first-child\):not\(\[data-active\]\)\{[^}]*display:block!important/,
    );
  });
});

test("exportDeck builds a deck and writes a PDF", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@slida/cli/page";
---

<Page title="Intro"><h1>Intro</h1></Page>
<Page title="Details"><h1>Details</h1></Page>
`,
    );
    const result = await exportDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      out: "deck.pdf",
      browserExecutablePath: await localBrowserExecutablePath(),
      logLevel: "silent",
    });
    expect(result.pdfFile).toBe(join(await realpath(projectRoot), "deck.pdf"));
    const pdf = await readFile(result.pdfFile);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
}, 60_000);

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

test("buildDeck renders MDX pages through the Google Basic flow layouts", async () => {
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

<layout id="page" />

# Google MDX page title

Google MDX page body

- Google MDX bullet

Google MDX follow-up

---

<layout id="two-column" />

# Google MDX column title

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
    expect(slideSectionCount(html)).toBe(2);
    expect(layoutCount(html, "page")).toBe(1);
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(html).toContain("Google MDX page title");
    expect(html).toContain("Google MDX page body");
    expect(html).toContain("Google MDX bullet");
    expect(html).toContain("Google MDX follow-up");
    expect(html).toContain("Google MDX column title");
    expect(html).toContain('class="slida-google-column slida-google-column--left"');
    expect(html).toContain("Google MDX left");
    expect(html).toContain('class="slida-google-column slida-google-column--right"');
    expect(html).toContain("Google MDX right");
    expect(html).not.toContain("<layout");
  });
});

test("buildDeck renders MDX pages through the Apple Basic flow layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default { theme: 'apple-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: Apple Basic MDX
---

<layout id="page" />

# Apple MDX page title

Apple MDX page subtitle

Apple MDX page body

- Apple MDX bullet

---

<layout id="two-column" />

# Apple MDX column title

<p slot="left">Apple MDX left</p>

<p slot="right">Apple MDX right</p>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideSectionCount(html)).toBe(2);
    expect(layoutCount(html, "page")).toBe(1);
    expect(layoutCount(html, "two-column")).toBe(1);
    expect(html).toContain("Apple MDX page title");
    expect(html).toContain("Apple MDX page subtitle");
    expect(html).toContain("Apple MDX page body");
    expect(html).toContain("Apple MDX bullet");
    expect(html).toContain("Apple MDX column title");
    expect(html).toContain('class="slida-apple-column slida-apple-column--left"');
    expect(html).toContain("Apple MDX left");
    expect(html).toContain('class="slida-apple-column slida-apple-column--right"');
    expect(html).toContain("Apple MDX right");
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
