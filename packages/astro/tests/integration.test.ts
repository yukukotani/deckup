import { build, type AstroIntegration } from "astro";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
const theme = "bold";
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

<layout id="cover" />

# Guide MDX Deck

---

# Guide Details
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
  const assetsDir = join(projectRoot, "dist", "_astro");

  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });
    cssParts.push(
      ...(await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
          .map((entry) => readFile(join(assetsDir, entry.name), "utf8")),
      )),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

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
    expect(intro).toContain('data-deckup-theme="bold"');
    expect(intro).not.toContain('data-deckup-theme="minimal"');
    const introCss = await readBuiltCss(projectRoot, intro);
    expect(intro).toContain("data-deckup-shell");
    expect(intro).toContain("data-deckup-navigation");
    expect(introCss).toContain(".deckup-navigation");
    expect(introCss).toContain("astro-dev-toolbar");
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
    expect(guide).not.toContain('data-deckup-theme="bold"');
    expect(guide).toContain("Guide MDX Deck");
    expect(guide).toContain("Guide Details");

    const docs = await readFile(join(projectRoot, "dist", "docs", "index.html"), "utf8");
    expect(docs).toContain("Host Docs");
    expect(docs).toContain("This MDX page is not a Deckup deck.");
    expect(docs).not.toContain("data-deckup-slide");
    expect(docs).not.toContain("data-deckup-layout");
  });
});
