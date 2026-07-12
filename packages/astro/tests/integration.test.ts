import { build, type AstroIntegration } from "astro";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import deckup from "../src/index.ts";

const astroPackageRoot = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const mdxPackageRoot = dirname(require.resolve("@astrojs/mdx/package.json"));

async function withHostProject(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-astro-integration-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function linkAstroPackage(projectRoot: string) {
  const scopeDir = join(projectRoot, "node_modules", "@deckup");
  await mkdir(scopeDir, { recursive: true });
  await symlink(astroPackageRoot, join(scopeDir, "astro"), "dir");
}

async function linkMdxPackage(projectRoot: string) {
  const scopeDir = join(projectRoot, "node_modules", "@astrojs");
  await mkdir(scopeDir, { recursive: true });
  await symlink(mdxPackageRoot, join(scopeDir, "mdx"), "dir");
}

async function writeHostFixture(projectRoot: string) {
  await linkAstroPackage(projectRoot);
  await linkMdxPackage(projectRoot);
  await mkdir(join(projectRoot, "source", "slides"), { recursive: true });
  await mkdir(join(projectRoot, "source", "pages"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  await writeFile(
    join(projectRoot, "source", "slides", "intro.astro"),
    `---
import Page from "@deckup/astro/page";
const theme = "default";
---

<Page title="Intro"><h1>Intro Astro Deck</h1></Page>
<Page title="Details"><h2>Astro Details</h2></Page>
`,
  );
  await writeFile(
    join(projectRoot, "source", "slides", "guide.mdx"),
    `---
title: Guide MDX Deck
theme: minimal
---

<PageMeta layout="cover" />

# Guide MDX Deck

---

# Guide Details
`,
  );
  await writeFile(
    join(projectRoot, "source", "slides", "google.astro"),
    `---
import Page from "@deckup/astro/page";
const theme = "google-basic";
---

<Page title="Google"><PageMeta layout="cover" /><h1>Google Astro Deck</h1></Page>
`,
  );
  await writeFile(
    join(projectRoot, "source", "slides", "apple.astro"),
    `---
import Page from "@deckup/astro/page";
const theme = "apple-basic";
---

<Page title="Apple"><PageMeta layout="cover" /><h1>Apple Astro Deck</h1></Page>
`,
  );
  await writeFile(
    join(projectRoot, "source", "pages", "docs.mdx"),
    `---
title: Host Docs
---

# Host Docs

This MDX page is not a Deckup deck.
`,
  );
}

async function readBuiltCss(projectRoot: string, html: string) {
  const cssParts = Array.from(
    html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g),
    (match) => match[1],
  );
  const linkedCss = Array.from(
    html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g),
    (match) => match[1],
  );
  cssParts.push(
    ...(await Promise.all(
      linkedCss.map((href) =>
        readFile(join(projectRoot, "dist", href.replace(/^\/+/, "")), "utf8"),
      ),
    )),
  );

  return cssParts.join("\n");
}

function countSlides(html: string) {
  return html.match(/data-deckup-slide(?=[\s=>])/g)?.length ?? 0;
}

function countLayouts(html: string, layout: string) {
  return html.match(new RegExp(`data-deckup-layout="${layout}"`, "g"))?.length ?? 0;
}

function finalConfigProbe(observed: { root?: string; srcDir?: string }): AstroIntegration {
  return {
    name: "deckup-test-final-config-probe",
    hooks: {
      "astro:config:done"({ config }) {
        observed.root = fileURLToPath(config.root);
        observed.srcDir = fileURLToPath(config.srcDir);
      },
    },
  };
}

test("build injects one route per Astro and MDX deck and leaves host MDX untouched", async () => {
  await withHostProject(async (projectRoot) => {
    await writeHostFixture(projectRoot);
    const observed: { root?: string; srcDir?: string } = {};

    await build({
      root: projectRoot,
      srcDir: join(projectRoot, "source"),
      outDir: join(projectRoot, "dist"),
      configFile: false,
      logLevel: "silent",
      integrations: [
        deckup({ decks: "source/slides/*.{astro,mdx}", base: "/slides" }),
        finalConfigProbe(observed),
      ],
    });

    expect(resolve(observed.root ?? "")).toBe(resolve(projectRoot));
    expect(resolve(observed.srcDir ?? "")).toBe(resolve(projectRoot, "source"));

    const intro = await readFile(
      join(projectRoot, "dist", "slides", "intro", "index.html"),
      "utf8",
    );
    expect(countSlides(intro)).toBe(2);
    expect(countLayouts(intro, "cover")).toBe(1);
    expect(countLayouts(intro, "default")).toBe(1);
    expect(intro).toContain('data-slide-count="2"');
    expect(intro).toContain('data-deckup-theme="default"');
    expect(intro).not.toContain('data-deckup-theme="minimal"');
    expect(intro).not.toContain("<layout");
    expect(intro).not.toContain("PageMeta");
    const introCss = await readBuiltCss(projectRoot, intro);
    expect(intro).toContain("data-deckup-shell");
    expect(intro).toContain("data-deckup-navigation");
    expect(introCss).toContain(".deckup-navigation");
    expect(introCss).toContain("#f7f8fc");
    expect(introCss).not.toContain("#f3f4f6");
    expect(introCss).not.toContain("--gb-blue");
    expect(introCss).not.toContain("--ab-text");
    expect(introCss).not.toContain("astro-dev-toolbar");
    expect(intro).toContain("Intro Astro Deck");
    expect(intro).toContain("Astro Details");

    const guide = await readFile(
      join(projectRoot, "dist", "slides", "guide", "index.html"),
      "utf8",
    );
    expect(countSlides(guide)).toBe(2);
    expect(countLayouts(guide, "cover")).toBe(1);
    expect(countLayouts(guide, "default")).toBe(1);
    expect(guide).toContain('data-slide-count="2"');
    expect(guide).toContain('data-deckup-theme="minimal"');
    expect(guide).not.toContain('data-deckup-theme="default"');
    expect(guide).not.toContain("<layout");
    expect(guide).not.toContain("PageMeta");
    expect(guide).toContain("Guide MDX Deck");
    expect(guide).toContain("Guide Details");
    const guideCss = await readBuiltCss(projectRoot, guide);
    expect(guideCss).toContain("#f3f4f6");
    expect(guideCss).not.toContain("#f7f8fc");
    expect(guideCss).not.toContain("--gb-blue");
    expect(guideCss).not.toContain("--ab-text");

    const google = await readFile(
      join(projectRoot, "dist", "slides", "google", "index.html"),
      "utf8",
    );
    expect(google).toContain('data-deckup-theme="google-basic"');
    expect(google).toContain("Google Astro Deck");
    expect(google).not.toContain("<layout");
    expect(google).not.toContain("PageMeta");
    const googleCss = await readBuiltCss(projectRoot, google);
    expect(googleCss).toContain("--gb-blue");
    expect(googleCss).not.toContain("#f7f8fc");
    expect(googleCss).not.toContain("#f3f4f6");
    expect(googleCss).not.toContain("--ab-text");

    const apple = await readFile(
      join(projectRoot, "dist", "slides", "apple", "index.html"),
      "utf8",
    );
    expect(apple).toContain('data-deckup-theme="apple-basic"');
    expect(apple).toContain("Apple Astro Deck");
    expect(apple).not.toContain("<layout");
    expect(apple).not.toContain("PageMeta");
    const appleCss = await readBuiltCss(projectRoot, apple);
    expect(appleCss).toContain("--ab-text");
    expect(appleCss).not.toContain("#f7f8fc");
    expect(appleCss).not.toContain("#f3f4f6");
    expect(appleCss).not.toContain("--gb-blue");

    const docs = await readFile(join(projectRoot, "dist", "docs", "index.html"), "utf8");
    expect(docs).toContain("Host Docs");
    expect(docs).toContain("This MDX page is not a Deckup deck.");
    expect(docs).not.toContain("data-deckup-slide");
    expect(docs).not.toContain("data-deckup-layout");
  });
});
