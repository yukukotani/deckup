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
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { expect, test } from "vite-plus/test";

import {
  buildDeck,
  createAstroInlineConfig,
  DEFAULT_BUILD_OUT_DIR,
  exportDeck,
  exportDeckPng,
  exportDeckPngWithOperations,
  normalizeBuildOutDir,
  normalizeExportOutFile,
  startDevServer,
  type DeckupPngExportOperations,
} from "../src/astro.ts";
import {
  pathExists,
  prepareRuntime,
  resolveProjectRoot,
  resolveRuntimeSourceDir,
} from "../src/runtime.ts";

function paethPredictor(left: number, above: number, upperLeft: number) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(buffer: Buffer) {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData: Buffer[] = [];

  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(
      `Unsupported test PNG format: depth=${bitDepth}, color=${colorType}, interlace=${interlace}`,
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset];
      sourceOffset += 1;
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const above = y > 0 ? pixels[rowOffset - stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowOffset - stride + x - channels] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : filter === 4
                  ? paethPredictor(left, above, upperLeft)
                  : undefined;
      if (predictor === undefined) throw new Error(`Unsupported PNG filter: ${filter}`);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
  }

  return {
    width,
    height,
    pixel(x: number, y: number) {
      const offset = y * stride + x * channels;
      return [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        channels === 4 ? pixels[offset + 3] : 255,
      ];
    },
  };
}

function createSilentWavDataUrl() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

type PngOperationState = {
  builds: number;
  launches: number;
  pages: number;
  browserCloses: number;
  serverCloses: number;
  screenshots: string[];
  selectedSlides: number[];
};

function createPngOperations(
  fixture: { projectRoot: string; deckFile: string },
  source: string,
  failAtScreenshot?: number,
) {
  const state: PngOperationState = {
    builds: 0,
    launches: 0,
    pages: 0,
    browserCloses: 0,
    serverCloses: 0,
    screenshots: [],
    selectedSlides: [],
  };
  const createLocator = (slideIndex = 0) => ({
    nth(index: number) {
      return createLocator(index);
    },
    async boundingBox() {
      return { width: 1600, height: 900 };
    },
    async screenshot(options: { path: string }) {
      state.screenshots.push(options.path);
      await writeFile(options.path, `slide:${slideIndex + 1}`);
      if (state.screenshots.length === failAtScreenshot) {
        throw new Error("capture failed");
      }
      return Buffer.from("png");
    },
  });
  const operations = {
    async createDeckupAstroConfig() {
      return {
        paths: {
          projectRoot: fixture.projectRoot,
          runtimeSourceDir: join(fixture.projectRoot, "runtime"),
          runtimeOutDir: join(fixture.projectRoot, ".deckup"),
        },
        deck: {
          filePath: fixture.deckFile,
          projectRelativePath: "slides/deck.astro",
          format: "astro" as const,
        },
        astroConfig: {} as never,
      };
    },
    async build() {
      state.builds += 1;
    },
    async readDeckSource() {
      return source;
    },
    async removePngOutputDirectory(outputDir: string) {
      await rm(outputDir, { force: true, recursive: true });
    },
    async serveStaticExportOutDir() {
      return {
        url: "http://127.0.0.1:4321/",
        async close() {
          state.serverCloses += 1;
        },
      };
    },
    async launchBrowser() {
      state.launches += 1;
      return {
        async newPage() {
          state.pages += 1;
          return {
            async goto() {},
            async addStyleTag() {},
            async evaluate(_pageFunction: unknown, argument: unknown) {
              if (typeof argument === "number") state.selectedSlides.push(argument);
            },
            async waitForFunction() {},
            locator() {
              return createLocator();
            },
          };
        },
        async close() {
          state.browserCloses += 1;
        },
      };
    },
  } as unknown as DeckupPngExportOperations;
  return { operations, state };
}

const cliPackageRoot = fileURLToPath(new URL("..", import.meta.url));

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-astro-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function linkCliPackage(projectRoot: string) {
  const nodeModulesDir = join(projectRoot, "node_modules");
  await mkdir(nodeModulesDir, { recursive: true });
  await symlink(cliPackageRoot, join(nodeModulesDir, "deckup"), "dir");
}

async function localBrowserExecutablePath() {
  const candidates = [
    process.env.DECKUP_CHROMIUM_EXECUTABLE_PATH,
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
  return html.match(/data-deckup-slide(?=[\s=>])/g)?.length ?? 0;
}

function layoutCount(html: string, layout: string) {
  return html.match(new RegExp(`data-deckup-layout="${layout}"`, "g"))?.length ?? 0;
}

function slideSectionCount(html: string) {
  return html.match(/<section\b[^>]*data-deckup-slide/g)?.length ?? 0;
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

const builtInViewerThemes = ["default", "minimal", "google-basic", "apple-basic"] as const;

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
  await writeThemeLayoutPackage(projectRoot, "@acme/deckup-layout-theme");
  await writeFile(
    join(projectRoot, "deckup.config.ts"),
    "export default { theme: '@acme/deckup-layout-theme' };\n",
  );
}

test("resolveProjectRoot returns an absolute project root", () => {
  expect(resolveProjectRoot(".")).toBe(process.cwd());
});

test("resolveRuntimeSourceDir points at the package runtime directory", () => {
  expect(resolveRuntimeSourceDir()).toBe(fileURLToPath(new URL("../runtime", import.meta.url)));
});

test("normalizeBuildOutDir resolves the default output under the project root", () => {
  const root = resolve("/tmp/deckup-project");
  expect(normalizeBuildOutDir(root)).toBe(join(root, DEFAULT_BUILD_OUT_DIR));
});

test("normalizeExportOutFile resolves the default PDF output from the selected deck basename", () => {
  const root = resolve("/tmp/deckup-project");
  expect(
    normalizeExportOutFile(root, {
      filePath: join(root, "slides", "talk.astro"),
      projectRelativePath: "slides/talk.astro",
      format: "astro",
    }),
  ).toBe(join(root, "talk.pdf"));
});

test("createAstroInlineConfig disables external config and wires runtime dirs", () => {
  const root = resolve("/tmp/deckup-project");
  const config = createAstroInlineConfig(
    {
      projectRoot: root,
      runtimeSourceDir: join(root, "node_modules/deckup/runtime"),
      runtimeOutDir: join(root, ".deckup/runtime"),
    },
    { outDir: "public-deck", logLevel: "warn" },
  );

  expect(config.root).toBe(root);
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBeUndefined();
  expect(config.outDir).toBe(join(root, "public-deck"));
  expect(config.logLevel).toBe("warn");
});

test("prepareRuntime creates the runtime work directory", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-runtime-"));
  try {
    const missingRuntimeSource = join(projectRoot, "missing-runtime");
    const paths = await prepareRuntime(projectRoot, missingRuntimeSource);
    expect(paths.runtimeSourceDir).toBe(missingRuntimeSource);
    await expect(pathExists(paths.runtimeOutDir)).resolves.toBe(true);
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
import Page from "@deckup/astro/page";
---

<Page title="Intro"><PageMeta layout="cover" /><h1>Intro</h1></Page>
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
    expect(html.match(/data-deckup-layout="cover"/g)?.length ?? 0).toBe(1);
    expect(html.match(/data-deckup-layout="default"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('data-slide-count="2"');
    expect(html).toContain("Intro");
    expect(html).toContain("Details");
    expect(html).not.toContain("<layout");
    expect(html).not.toContain("PageMeta");
  });
});

test("buildDeck emits built-in Tailwind utilities for Astro decks", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await expect(pathExists(join(projectRoot, "node_modules", "tailwindcss"))).resolves.toBe(false);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="Tailwind Astro">
  <h1 class="text-5xl font-bold text-blue-600">Astro utilities</h1>
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
    const css = await readBuiltCss(projectRoot, html);
    expect(html).toContain("Astro utilities");
    expect(css).toMatch(/\.text-5xl\{[^}]*font-size:/);
    expect(css).toMatch(/\.font-bold\{[^}]*font-weight:/);
    expect(css).toMatch(/\.text-blue-600\{[^}]*color:/);
  });
});

test("buildDeck emits built-in Tailwind utilities for MDX decks", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await expect(pathExists(join(projectRoot, "node_modules", "tailwindcss"))).resolves.toBe(false);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: Tailwind MDX
---

# MDX utilities

<div className="mx-auto max-w-xl text-center">Built in for MDX</div>
`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    const css = await readBuiltCss(projectRoot, html);
    expect(html).toContain("Built in for MDX");
    expect(css).toMatch(/\.mx-auto\{[^}]*margin-inline:auto/);
    expect(css).toMatch(/\.max-w-xl\{[^}]*max-width:/);
    expect(css).toMatch(/\.text-center\{[^}]*text-align:center/);
  });
});

test("buildDeck omits built-in Tailwind output when disabled", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { integrations: { tailwind: false } };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="No Tailwind"><h1 class="text-5xl">Unstyled utility</h1></Page>
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
    expect(html).toContain('class="text-5xl"');
    expect(css).not.toMatch(/\.text-5xl\{/);
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
import Page from "@deckup/astro/page";
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
      join(projectRoot, "deckup.config.ts"),
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
import Page from "@deckup/astro/page";
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
import Page from "@deckup/astro/page";
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
import Page from "@deckup/astro/page";
---

<Page title="Columns"><PageMeta layout="two-column" /><h1>Column title</h1><div slot="left">Left content</div><div slot="right">Right content</div></Page>
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
    expect(html).toContain('class="deckup-slide"');
    expect(html).toContain("data-deckup-slide");
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
    expect(html).not.toContain("PageMeta");
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
      /Missing Deckup deck file/,
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
import Page from "@deckup/astro/page";
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

test("buildDeck treats a lowercase <layout> tag as ordinary content, never a Deckup layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="Intro"><layout id="two-column" /><h1>Intro</h1></Page>
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
    expect(html.match(/data-deckup-layout="cover"/g)?.length ?? 0).toBe(1);
    expect(html.match(/data-deckup-layout="two-column"/g)?.length ?? 0).toBe(0);
    expect(html).toContain("Intro");
    expect(html).not.toContain("PageMeta");
  });
});

const invalidAstroPageMetaBuildCases: Array<[string, string, RegExp]> = [
  [
    "duplicate declarations",
    `<PageMeta layout="cover" /><PageMeta layout="default" /><h1>Intro</h1>`,
    /multiple PageMeta declarations/,
  ],
  ["missing layout", `<PageMeta /><h1>Intro</h1>`, /exactly one layout attribute/],
  ["dynamic layout", `<PageMeta layout={layout} /><h1>Intro</h1>`, /static string/],
  ["empty layout", `<PageMeta layout="" /><h1>Intro</h1>`, /non-empty string/],
  [
    "invalid layout id",
    `<PageMeta layout="Cover Slide" /><h1>Intro</h1>`,
    /Invalid Deckup layout id/,
  ],
  [
    "unknown attribute",
    `<PageMeta layout="cover" extra="value" /><h1>Intro</h1>`,
    /exactly one layout attribute/,
  ],
  [
    "duplicate layout attribute",
    `<PageMeta layout="cover" layout="default" /><h1>Intro</h1>`,
    /exactly one layout attribute/,
  ],
  ["spread attribute", `<PageMeta {...props} /><h1>Intro</h1>`, /exactly one layout attribute/],
  ["children", `<PageMeta layout="cover">child</PageMeta><h1>Intro</h1>`, /must not have children/],
  [
    "non-self-closing marker",
    `<PageMeta layout="cover"></PageMeta><h1>Intro</h1>`,
    /must be self-closing/,
  ],
  ["late marker", `<h1>Intro</h1><PageMeta layout="cover" />`, /first meaningful direct child/],
  ["nested marker", `<div><PageMeta layout="cover" /></div>`, /first meaningful direct child/],
];

for (const [name, body, matcher] of invalidAstroPageMetaBuildCases) {
  test(`buildDeck rejects Astro PageMeta ${name}`, async () => {
    await expectAstroDeckError(
      `---
import Page from "@deckup/astro/page";
const layout = "cover";
const props = {};
---

<Page>${body}</Page>
`,
      matcher,
    );
  });
}

async function expectMdxDeckError(deckSource: string, matcher: RegExp) {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(join(projectRoot, "slides", "bad.mdx"), deckSource);
    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.mdx", logLevel: "silent" }),
    ).rejects.toThrow(matcher);
  });
}

test("buildDeck treats a lowercase <layout> tag in MDX as ordinary content, never a Deckup layout", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `<layout id="two-column" />\n\n# Intro\n`,
    );

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.mdx",
      outDir: "dist",
      logLevel: "silent",
    });

    const html = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
    expect(slideCount(html)).toBe(1);
    expect(html.match(/data-deckup-layout="cover"/g)?.length ?? 0).toBe(1);
    expect(html.match(/data-deckup-layout="two-column"/g)?.length ?? 0).toBe(0);
    expect(html).toContain("Intro");
    expect(html).not.toContain("PageMeta");
  });
});

test("buildDeck rejects nested MDX PageMeta", async () => {
  await expectMdxDeckError(
    `<div><PageMeta layout="cover" /></div>\n`,
    /first meaningful direct child/,
  );
});

test("buildDeck rejects non-self-closing MDX PageMeta", async () => {
  await expectMdxDeckError(
    `<PageMeta layout="cover"></PageMeta>\n\n# Intro\n`,
    /must be self-closing/,
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
import Page from "@deckup/astro/page";
---

<Page><PageMeta layout="missing" /><h1>Missing</h1></Page>
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
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'google-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="Google Page"><PageMeta layout="page" /><h1>Google page title</h1><p>Google page body</p><ul><li>Google bullet</li></ul><p>Google follow-up</p></Page>
<Page title="Google Columns"><PageMeta layout="two-column" /><h1>Google column title</h1><p slot="left">Google left</p><p slot="right">Google right</p></Page>
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
    expect(html).toContain('class="deckup-google-column deckup-google-column--left"');
    expect(html).toContain("Google left");
    expect(html).toContain('class="deckup-google-column deckup-google-column--right"');
    expect(html).toContain("Google right");
    expect(html).not.toContain("<layout");
    expect(html).not.toContain("PageMeta");
  });
});

test("buildDeck renders Astro pages through the Apple Basic flow layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'apple-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="Apple Page"><PageMeta layout="page" /><h1>Apple page title</h1><p>Apple page subtitle</p><p>Apple page body</p><ul><li>Apple bullet</li></ul></Page>
<Page title="Apple Columns"><PageMeta layout="two-column" /><h1>Apple column title</h1><p slot="left">Apple left</p><p slot="right">Apple right</p></Page>
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
    expect(html).toContain('class="deckup-apple-column deckup-apple-column--left"');
    expect(html).toContain("Apple left");
    expect(html).toContain('class="deckup-apple-column deckup-apple-column--right"');
    expect(html).toContain("Apple right");
    expect(html).not.toContain("<layout");
    expect(html).not.toContain("PageMeta");
  });
});

for (const theme of builtInViewerThemes) {
  test(`buildDeck emits fixed 16:9 viewer CSS for ${theme}`, async () => {
    await withProjectRoot(async (projectRoot) => {
      await linkCliPackage(projectRoot);
      await writeFile(
        join(projectRoot, "deckup.config.ts"),
        `export default { theme: '${theme}' };\n`,
      );
      await mkdir(join(projectRoot, "slides"));
      await writeFile(
        join(projectRoot, "slides", "deck.astro"),
        `---
import Page from "@deckup/astro/page";
---

<Page title="Intro"><PageMeta layout="cover" /><h1>Intro</h1><p>Body</p></Page>
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
      expect(html).toContain("data-deckup-navigation");
      expect(html).toContain("data-deckup-nav-drag-handle");
      expect(html).toContain("data-deckup-nav-prev");
      expect(html).toContain("data-deckup-nav-next");
      expect(html).toContain("data-deckup-nav-fullscreen");
      expect(html).toContain("data-deckup-current");
      expect(html).toContain("data-deckup-total");
      expect(html).toContain('aria-label="Slide navigation"');
      expect(html).toContain('aria-label="Move navigation menu"');
      expect(html).toContain('aria-label="Previous slide"');
      expect(html).toContain('aria-label="Next slide"');
      expect(html).toContain('aria-label="Enter fullscreen"');
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('title="Enter fullscreen"');
      expect(css).toMatch(
        /body\{(?=[^}]*display:grid)(?=[^}]*place-items:center)(?=[^}]*background:#111)[^}]*\}/,
      );
      expect(css).toMatch(/\.deckup-shell\{[^}]*aspect-ratio:16\/9/);
      expect(css).toContain("container-type:size");
      expect(css).toMatch(
        /\.deckup-deck,\.deckup-empty\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0/,
      );
      expect(css).toMatch(/\.deckup-slide\{[^}]*width:100%[^}]*height:100%[^}]*min-height:0/);
      expect(css).toMatch(
        /\.deckup-status\{(?=[^}]*position:fixed)(?=[^}]*display:inline-flex)[^}]*\}/,
      );
      expect(css).toMatch(
        /\.deckup-status\{(?=[^}]*left:50%)(?=[^}]*bottom:1rem)(?=[^}]*transform:translate(?:X)?\(-50%\))[^}]*\}/,
      );
      expect(css).toContain(".deckup-navigation__button");
      expect(css).toContain(".deckup-navigation__handle");
      expect(css).toMatch(/\.deckup-navigation__handle\{[^}]*touch-action:none/);
      expect(css).toMatch(
        /\.deckup-navigation__button:not\(:disabled\),\.deckup-navigation__handle\{[^}]*cursor:pointer/,
      );
      expect(css).toMatch(
        /\.deckup-navigation__button:not\(:disabled\):hover,[^}]*\.deckup-navigation__handle:focus-visible\{[^}]*background:/,
      );
      expect(css).toMatch(/\.deckup-navigation__button:disabled\{[^}]*opacity:/);
      expect(css).not.toMatch(/\.deckup-status\{display:none!important\}/);
      expect(css).not.toMatch(/\.deckup-navigation\{display:none!important\}/);

      expect(css).not.toMatch(/body\{[^}]*background:var\(--deckup-bg\)/);
      expect(css).toContain("--deckup-cqw:1cqw");
      expect(css).toContain("var(--deckup-cqw)");
      expect(css).not.toContain("6vw");
      expect(css).not.toContain("9vw");

      if (theme === "google-basic" || theme === "apple-basic") {
        expect(css).not.toMatch(/\[data-deckup-layout\]>:is\(h1,p,ul,ol\)\{[^}]*position:absolute/);
        expect(css).not.toMatch(
          /\[data-deckup-layout=(?:"page"|page|"two-column"|two-column)\]>[^{}]*(?:first-of-type|nth-of-type)[^{]*\{(?=[^}]*(?:top|left):)[^}]*\}/,
        );
        expect(css).not.toMatch(
          /[^{}]*\.deckup-(?:google|apple)-column[^{}]*\{[^}]*position:absolute/,
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
        join(projectRoot, "deckup.config.ts"),
        `export default { theme: '${theme}' };\n`,
      );
      await mkdir(join(projectRoot, "slides"));
      await writeFile(
        join(projectRoot, "slides", "deck.astro"),
        `---
import Page from "@deckup/astro/page";
---

<Page title="Cover"><PageMeta layout="cover" /><h1>Cover title</h1><p>Cover subtitle</p></Page>
<Page title="Section"><PageMeta layout="section" /><h1>Section title</h1></Page>
<Page title="Number"><PageMeta layout="number" /><p>42</p><p>Number caption</p></Page>
<Page title="Quote"><PageMeta layout="quote" /><p>Quote body</p><p>Quote name</p></Page>
<Page title="Statement"><PageMeta layout="statement" /><p>Statement body</p></Page>
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
      expect(html).not.toContain("PageMeta");
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
import Page from "@deckup/astro/page";
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
    expect(css).toContain("[data-deckup-navigation]");
    expect(css).toMatch(/break-after:page|page-break-after:always/);
    expect(css).toMatch(/@page\{size:16in 9in;margin:0\}/);
    expect(css).toMatch(
      /\.deckup-slide,\.deckup-slide\[hidden\],\.deckup-slide:not\(:first-child\):not\(\[data-active\]\)\{(?=[^}]*height:100vh)(?=[^}]*overflow:hidden)[^}]*\}/,
    );
    expect(css).not.toMatch(
      /\.deckup-slide,\.deckup-slide\[hidden\],\.deckup-slide:not\(:first-child\):not\(\[data-active\]\)\{[^}]*display:block!important/,
    );
  });
});

test("exportDeckPng builds once and reuses one browser and page for ordered selected slides", async () => {
  await withProjectRoot(async (projectRoot) => {
    const deckFile = join(projectRoot, "slides", "deck.astro");
    await mkdir(join(projectRoot, "slides"));
    await writeFile(deckFile, "<Page /><Page /><Page /><Page />\n");
    const { operations, state } = createPngOperations(
      { projectRoot, deckFile },
      "<Page /><Page /><Page /><Page />\n",
    );
    const result = await exportDeckPngWithOperations(
      { root: projectRoot, deckFile: "slides/deck.astro", out: "images", slides: "3,1,3-4" },
      operations,
    );
    expect(state).toMatchObject({
      builds: 1,
      launches: 1,
      pages: 1,
      browserCloses: 1,
      serverCloses: 1,
      selectedSlides: [1, 3, 4],
    });
    expect(result.pngFiles.map((file) => basename(file))).toEqual([
      "slide-001.png",
      "slide-003.png",
      "slide-004.png",
    ]);
    expect(state.screenshots).toEqual(result.pngFiles);
  });
});

test("exportDeckPng validates the complete selection before build or output cleanup", async () => {
  await withProjectRoot(async (projectRoot) => {
    const deckFile = join(projectRoot, "slides", "deck.astro");
    const pngDir = join(projectRoot, "images");
    const sentinel = join(pngDir, "sentinel.txt");
    await mkdir(join(projectRoot, "slides"));
    await mkdir(pngDir);
    await writeFile(deckFile, "<Page /><Page />\n");
    await writeFile(sentinel, "keep");
    const { operations, state } = createPngOperations(
      { projectRoot, deckFile },
      "<Page /><Page />\n",
    );
    await expect(
      exportDeckPngWithOperations(
        { root: projectRoot, deckFile: "slides/deck.astro", out: "images", slides: "0,99" },
        operations,
      ),
    ).rejects.toThrow(/slide selection/);
    expect(state.builds).toBe(0);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
  });
});

test("exportDeckPng revalidates a symlinked output immediately before deletion", async () => {
  await withProjectRoot(async (projectRoot) => {
    const deckFile = join(projectRoot, "slides", "deck.astro");
    const externalRoot = await mkdtemp(join(tmpdir(), "deckup-png-race-"));
    const safeTarget = join(externalRoot, "safe-target");
    const outputLink = join(externalRoot, "output-link");
    const projectSentinel = join(projectRoot, "sentinel.txt");
    await mkdir(join(projectRoot, "slides"));
    await mkdir(safeTarget);
    await writeFile(deckFile, "<Page />\n");
    await writeFile(projectSentinel, "keep");
    await symlink(safeTarget, outputLink, "dir");
    const { operations, state } = createPngOperations({ projectRoot, deckFile }, "<Page />\n");
    operations.build = async () => {
      state.builds += 1;
      await rm(outputLink, { force: true, recursive: true });
      await symlink(projectRoot, outputLink, "dir");
    };

    try {
      await expect(
        exportDeckPngWithOperations(
          { root: projectRoot, deckFile: "slides/deck.astro", out: outputLink },
          operations,
        ),
      ).rejects.toThrow(/project root/);
      expect(state).toMatchObject({ builds: 1, launches: 0, pages: 0 });
      await expect(readFile(projectSentinel, "utf8")).resolves.toBe("keep");
    } finally {
      await rm(externalRoot, { force: true, recursive: true });
    }
  });
});

test("exportDeckPng removes partial output and closes browser and server after capture failure", async () => {
  await withProjectRoot(async (projectRoot) => {
    const deckFile = join(projectRoot, "slides", "deck.astro");
    const pngDir = join(projectRoot, "images");
    await mkdir(join(projectRoot, "slides"));
    await writeFile(deckFile, "<Page /><Page />\n");
    const { operations, state } = createPngOperations(
      { projectRoot, deckFile },
      "<Page /><Page />\n",
      2,
    );
    await expect(
      exportDeckPngWithOperations(
        { root: projectRoot, deckFile: "slides/deck.astro", out: "images" },
        operations,
      ),
    ).rejects.toThrow(/capture failed/);
    expect(state).toMatchObject({ browserCloses: 1, serverCloses: 1 });
    await expect(pathExists(pngDir)).resolves.toBe(false);
  });
});

test("exportDeckPng reports both capture and partial-output cleanup failures", async () => {
  await withProjectRoot(async (projectRoot) => {
    const deckFile = join(projectRoot, "slides", "deck.astro");
    await mkdir(join(projectRoot, "slides"));
    await writeFile(deckFile, "<Page />\n");
    const { operations, state } = createPngOperations({ projectRoot, deckFile }, "<Page />\n", 1);
    let removeCalls = 0;
    operations.removePngOutputDirectory = async (outputDir) => {
      removeCalls += 1;
      if (removeCalls === 2) throw new Error("cleanup failed");
      await rm(outputDir, { force: true, recursive: true });
    };

    let receivedError: unknown;
    try {
      await exportDeckPngWithOperations(
        { root: projectRoot, deckFile: "slides/deck.astro", out: "images" },
        operations,
      );
    } catch (error) {
      receivedError = error;
    }
    expect(receivedError).toBeInstanceOf(AggregateError);
    expect((receivedError as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "capture failed" }),
      expect.objectContaining({ message: "cleanup failed" }),
    ]);
    expect(state).toMatchObject({ browserCloses: 1, serverCloses: 1 });
  });
});

test("exportDeckPng writes all and selected slides as 1600x900 slide-only PNGs", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="First" class="png-first"><h1>PNG FIRST</h1></Page>
<Page title="Second" class="png-second">
  <style is:global>
    body { background: #ff0000 !important; }
    .deckup-shell { border: 10px solid #00ff00 !important; }
    .deckup-navigation { width: 100vw; height: 200px; bottom: 0; background: #ff00ff !important; }
    .png-first { background: #abcdef !important; }
    .png-second { background: #123456 !important; }
  </style>
  <h1>PNG SECOND</h1>
</Page>
`,
    );
    const browserExecutablePath = await localBrowserExecutablePath();
    const resolvedProjectRoot = await realpath(projectRoot);
    const allPngDir = join(resolvedProjectRoot, "images-all");
    await mkdir(allPngDir);
    await writeFile(join(allPngDir, "sentinel.txt"), "remove");
    const allResult = await exportDeckPng({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      out: "images-all",
      browserExecutablePath,
      logLevel: "silent",
    });
    expect(allResult.pngFiles).toEqual([
      join(allPngDir, "slide-001.png"),
      join(allPngDir, "slide-002.png"),
    ]);
    expect((await readdir(allPngDir)).sort()).toEqual(["slide-001.png", "slide-002.png"]);

    const selectedPngDir = join(resolvedProjectRoot, "images-selected");
    const selectedResult = await exportDeckPng({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      out: "images-selected",
      slides: "2",
      browserExecutablePath,
      logLevel: "silent",
    });
    expect(selectedResult.pngFiles).toEqual([join(selectedPngDir, "slide-002.png")]);
    expect(await readdir(selectedPngDir)).toEqual(["slide-002.png"]);

    for (const pngFile of [allResult.pngFiles[1], selectedResult.pngFiles[0]]) {
      const image = decodePng(await readFile(pngFile));
      expect([image.width, image.height]).toEqual([1600, 900]);
      expect(image.pixel(0, 0)).toEqual([0x12, 0x34, 0x56, 0xff]);
      expect(image.pixel(1599, 899)).toEqual([0x12, 0x34, 0x56, 0xff]);
      expect(image.pixel(800, 850)).toEqual([0x12, 0x34, 0x56, 0xff]);
    }
    await expect(pathExists(join(projectRoot, "dist", "index.html"))).resolves.toBe(true);
  });
}, 120_000);

test("exportDeckPng waits for active-slide image and media readiness before capture", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    const silentWavDataUrl = createSilentWavDataUrl();
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="Initial"><h1>INITIAL</h1></Page>
<Page title="Delayed image" class="png-delayed-image">
  <style is:global>
    .png-delayed-image { background: #ff0000 !important; }
    #delayed-image { position: absolute; inset: 0; width: 1600px; height: 900px; }
    .png-delayed-media { background: #ff0000 !important; }
    #media-ready-indicator { position: absolute; inset: 0; background: #ff0000; }
  </style>
  <img id="delayed-image" alt="" />
</Page>
<Page title="Delayed media" class="png-delayed-media">
  <audio id="delayed-media"></audio>
  <div id="media-ready-indicator"></div>
  <script is:inline>
    const scheduledReadiness = new Set();
    const scheduleReadiness = () => {
      if (window.location.hash === "#2" && !scheduledReadiness.has("image")) {
        scheduledReadiness.add("image");
        window.setTimeout(() => {
          const image = document.querySelector("#delayed-image");
          if (image instanceof HTMLImageElement) {
            image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%232468ac'/%3E%3C/svg%3E";
          }
        }, 250);
      }
      if (window.location.hash === "#3" && !scheduledReadiness.has("media")) {
        scheduledReadiness.add("media");
        window.setTimeout(() => {
          const media = document.querySelector("#delayed-media");
          const indicator = document.querySelector("#media-ready-indicator");
          if (media instanceof HTMLMediaElement && indicator instanceof HTMLElement) {
            media.addEventListener("loadeddata", () => {
              indicator.style.background = "#357a38";
            }, { once: true });
            media.src = ${JSON.stringify(silentWavDataUrl)};
            media.load();
          }
        }, 250);
      }
    };
    window.addEventListener("hashchange", scheduleReadiness);
    scheduleReadiness();
  </script>
</Page>
`,
    );

    const result = await exportDeckPng({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      out: "readiness-images",
      slides: "2,3",
      browserExecutablePath: await localBrowserExecutablePath(),
      logLevel: "silent",
    });

    const imageSlide = decodePng(await readFile(result.pngFiles[0]));
    expect(imageSlide.pixel(800, 450)).toEqual([0x24, 0x68, 0xac, 0xff]);
    const mediaSlide = decodePng(await readFile(result.pngFiles[1]));
    expect(mediaSlide.pixel(800, 450)).toEqual([0x35, 0x7a, 0x38, 0xff]);
  });
}, 120_000);

test("exportDeck builds a deck and writes a PDF", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
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

<PageMeta layout="cover" />

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
    expect(html).not.toContain("PageMeta");
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

<PageMeta layout="two-column" />

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
    expect(html).not.toContain("PageMeta");
  });
});

test("buildDeck renders MDX pages through the Google Basic flow layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'google-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: Google Basic MDX
---

<PageMeta layout="page" />

# Google MDX page title

Google MDX page body

- Google MDX bullet

Google MDX follow-up

---

<PageMeta layout="two-column" />

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
    expect(html).toContain('class="deckup-google-column deckup-google-column--left"');
    expect(html).toContain("Google MDX left");
    expect(html).toContain('class="deckup-google-column deckup-google-column--right"');
    expect(html).toContain("Google MDX right");
    expect(html).not.toContain("<layout");
    expect(html).not.toContain("PageMeta");
  });
});

test("buildDeck renders MDX pages through the Apple Basic flow layouts", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await writeFile(
      join(projectRoot, "deckup.config.ts"),
      "export default { theme: 'apple-basic' };\n",
    );
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.mdx"),
      `---
title: Apple Basic MDX
---

<PageMeta layout="page" />

# Apple MDX page title

Apple MDX page subtitle

Apple MDX page body

- Apple MDX bullet

---

<PageMeta layout="two-column" />

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
    expect(html).toContain('class="deckup-apple-column deckup-apple-column--left"');
    expect(html).toContain("Apple MDX left");
    expect(html).toContain('class="deckup-apple-column deckup-apple-column--right"');
    expect(html).toContain("Apple MDX right");
    expect(html).not.toContain("<layout");
    expect(html).not.toContain("PageMeta");
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

<PageMeta layout="missing" />

# Missing
`,
    );

    await expect(
      buildDeck({ root: projectRoot, deckFile: "slides/bad.mdx", logLevel: "silent" }),
    ).rejects.toThrow(/does not provide layout "missing"/);
  });
});

test("dev and build share the built-in Tailwind asset resolution path", async () => {
  await withProjectRoot(async (projectRoot) => {
    await linkCliPackage(projectRoot);
    await mkdir(join(projectRoot, "slides"));
    await writeFile(
      join(projectRoot, "slides", "deck.astro"),
      `---
import Page from "@deckup/astro/page";
---

<Page title="Shared Tailwind"><h1 class="text-5xl">Shared path</h1></Page>
`,
    );
    const tailwindCssPath = join(await realpath(projectRoot), ".deckup", "tailwind.css");
    const { server } = await startDevServer({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      port: 0,
      logLevel: "silent",
    });
    let devTailwindSource: string;
    try {
      devTailwindSource = await readFile(tailwindCssPath, "utf8");
    } finally {
      await server.stop();
    }

    await buildDeck({
      root: projectRoot,
      deckFile: "slides/deck.astro",
      outDir: "dist",
      logLevel: "silent",
    });
    await expect(readFile(tailwindCssPath, "utf8")).resolves.toBe(devTailwindSource);
    expect(devTailwindSource).toBe('@import "tailwindcss" source("..");\n');
  });
});

const expectedThemeHeading = {
  default: { color: "rgb(26, 28, 40)", fontSize: "44px", fontWeight: "400" },
  minimal: { color: "rgb(17, 24, 39)", fontSize: "44px", fontWeight: "600" },
  "google-basic": { color: "rgb(255, 255, 255)", fontSize: "49.6px", fontWeight: "400" },
  "apple-basic": { color: "rgb(0, 0, 0)", fontSize: "70.88px", fontWeight: "600" },
} as const;

async function readCascadeComputedStyles(projectRoot: string) {
  const { server, address } = await startDevServer({
    root: projectRoot,
    deckFile: "slides/deck.astro",
    port: 0,
    logLevel: "silent",
  });
  try {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: await localBrowserExecutablePath(),
      headless: true,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
      return await page.locator("h1").evaluate((heading) => {
        const headingStyle = getComputedStyle(heading);
        const shell = document.querySelector<HTMLElement>("[data-deckup-shell]");
        if (!shell) throw new Error("Missing Deckup shell in cascade fixture.");
        const shellStyle = getComputedStyle(shell);
        return {
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          borderInlineStartWidth: shellStyle.borderInlineStartWidth,
          borderInlineEndWidth: shellStyle.borderInlineEndWidth,
          color: headingStyle.color,
          fontSize: headingStyle.fontSize,
          fontWeight: headingStyle.fontWeight,
        };
      });
    } finally {
      await browser.close();
    }
  } finally {
    await server.stop();
  }
}

for (const theme of builtInViewerThemes) {
  test(`Tailwind utilities preserve cascade for ${theme}`, async () => {
    await withProjectRoot(async (projectRoot) => {
      await linkCliPackage(projectRoot);
      await writeFile(
        join(projectRoot, "deckup.config.ts"),
        `export default { theme: '${theme}' };\n`,
      );
      await mkdir(join(projectRoot, "slides"));
      await writeFile(
        join(projectRoot, "slides", "deck.astro"),
        `---
import Page from "@deckup/astro/page";
---

<Page title="Cascade">
  <PageMeta layout="page" />
  <h1 class="text-5xl font-bold text-[#123456]">Computed utilities</h1>
</Page>
`,
      );

      expect(await readCascadeComputedStyles(projectRoot)).toMatchObject({
        colorScheme: "light",
        borderInlineStartWidth: "0px",
        borderInlineEndWidth: "0px",
        color: "rgb(18, 52, 86)",
        fontSize: "48px",
        fontWeight: "700",
      });
    });
  }, 120_000);

  test(`theme defaults preserve cascade without Tailwind for ${theme}`, async () => {
    await withProjectRoot(async (projectRoot) => {
      await linkCliPackage(projectRoot);
      await writeFile(
        join(projectRoot, "deckup.config.ts"),
        `export default { theme: '${theme}', integrations: { tailwind: false } };\n`,
      );
      await mkdir(join(projectRoot, "slides"));
      await writeFile(
        join(projectRoot, "slides", "deck.astro"),
        `---
import Page from "@deckup/astro/page";
---

<Page title="Cascade">
  <PageMeta layout="page" />
  <h1>Theme defaults</h1>
</Page>
`,
      );

      expect(await readCascadeComputedStyles(projectRoot)).toMatchObject({
        colorScheme: "light",
        borderInlineStartWidth: "0px",
        borderInlineEndWidth: "0px",
        ...expectedThemeHeading[theme],
      });
    });
  }, 120_000);
}
