import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";

import { DEFAULT_BUILD_OUT_DIR, DEFAULT_DEV_HOST } from "../src/astro.ts";
import * as commandModule from "../src/commands.ts";
import {
  buildCommand,
  entryCommand,
  executeBuildCommand,
  executeInspectThemeCommand,
  inspectCommand,
  inspectThemeCommand,
  normalizeBuildFormat,
  normalizeBuildValues,
  normalizeInspectThemeValues,
  normalizeLogLevel,
  normalizeOpenValues,
  openCommand,
  readCliVersion,
  runDeckup,
  VERSION,
  type DeckupBuildCommandOperations,
  type DeckupInspectThemeCommandOperations,
} from "../src/commands.ts";

const cliFile = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function runCli(args: string[], cwd?: string) {
  return spawnSync(process.execPath, ["--conditions=development", cliFile, ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function withCliProject(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "deckup-inspect-"));
  try {
    await writeFile(join(projectRoot, "package.json"), '{"type":"module"}\n');
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

async function writeInspectThemePackage(
  projectRoot: string,
  packageName: string,
  layouts: Record<string, string>,
) {
  const packageRoot = join(projectRoot, "node_modules", ...packageName.split("/"));
  const layoutsDir = join(packageRoot, "layouts");
  await mkdir(layoutsDir, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: {
        "./layouts/*.astro": "./layouts/*.astro",
        "./package.json": "./package.json",
      },
    }),
  );
  await Promise.all(
    Object.entries(layouts).map(([fileName, source]) =>
      writeFile(join(layoutsDir, fileName), source),
    ),
  );
}

test("VERSION matches the package.json version", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { version: string };
  expect(VERSION).toBe(packageJson.version);
});

async function withTempPackageJsonDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "deckup-cli-version-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

test("readCliVersion returns the version string from a valid package.json", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, JSON.stringify({ version: "1.2.3" }));
    expect(readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) })).toBe("1.2.3");
  });
});

test("readCliVersion throws a contextual error when package.json is missing", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    expect(() => readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) })).toThrow(
      /Deckup CLI version metadata is missing/,
    );
  });
});

test("readCliVersion preserves the read failure as the error cause", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    let caught: unknown;
    try {
      readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect(((caught as Error).cause as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});

test("readCliVersion throws a contextual error when package.json is malformed JSON", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, "{ not valid json");
    expect(() => readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) })).toThrow(
      /Deckup CLI version metadata is not valid JSON/,
    );
  });
});

test("readCliVersion preserves the parse failure as the error cause", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, "{ not valid json");
    let caught: unknown;
    try {
      readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
  });
});

test("readCliVersion throws a contextual error when the version field is missing", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, JSON.stringify({ name: "deckup" }));
    expect(() => readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) })).toThrow(
      /Deckup CLI version metadata must include a string version/,
    );
  });
});

test("readCliVersion throws a contextual error when the version field is not a string", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, JSON.stringify({ version: 123 }));
    expect(() => readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) })).toThrow(
      /Deckup CLI version metadata must include a string version/,
    );
  });
});

test("readCliVersion never falls back to 0.0.0", async () => {
  await withTempPackageJsonDir(async (dir) => {
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, JSON.stringify({ version: 0 }));
    let threw = false;
    try {
      readCliVersion({ packageJsonUrl: pathToFileURL(packageJsonPath) });
    } catch (error) {
      threw = true;
      expect((error as Error).message).not.toContain("0.0.0");
    }
    expect(threw).toBe(true);
  });
});

test("CLI prints headerless help exactly once", () => {
  const output = execFileSync(process.execPath, ["--conditions=development", cliFile, "--help"], {
    encoding: "utf8",
  });

  expect(output.match(/^USAGE:$/gm)).toHaveLength(1);
  expect(output).toContain("inspect");
  expect(output).not.toMatch(/^deckup \(deckup v[^)]+\)$/m);
});

test("normalizeInspectThemeValues requires a theme and normalizes json", () => {
  expect(normalizeInspectThemeValues({ themeName: " default ", json: true })).toEqual({
    themeName: " default ",
    json: true,
  });
  expect(() => normalizeInspectThemeValues({})).toThrow(/requires a theme name/);
});

test("executeInspectThemeCommand returns deterministic labeled output without runtime paths", async () => {
  const requests: unknown[] = [];
  const operations = {
    resolveProjectRoot(root: string | undefined) {
      requests.push({ root });
      return "/project";
    },
    async resolveDeckupThemeLayouts(projectRoot: string, themeName: unknown, options: unknown) {
      requests.push({ projectRoot, themeName, options });
      return {
        name: "fixture",
        filePath: "/private/theme/package.json",
        packageName: "@private/theme",
        packageRoot: "/private/theme",
        layoutsDir: "/private/theme/layouts",
        layouts: [
          {
            id: "zeta",
            filePath: "/private/theme/layouts/zeta.astro",
            importPath: "/@fs/private/theme/layouts/zeta.astro",
            hasDefaultSlot: false,
            slotNames: [],
          },
          {
            id: "alpha",
            filePath: "/private/theme/layouts/alpha.astro",
            importPath: "/@fs/private/theme/layouts/alpha.astro",
            hasDefaultSlot: true,
            slotNames: ["right", "default", "left", "right"],
          },
        ],
        slotNames: ["default", "left", "right"],
        source: "package" as const,
      };
    },
  } as unknown as DeckupInspectThemeCommandOperations;

  const output = await executeInspectThemeCommand(
    { themeName: "fixture", json: false, root: "fixture-root" },
    operations,
  );

  expect(requests).toEqual([
    { root: "fixture-root" },
    { projectRoot: "/project", themeName: "fixture", options: { sourceMode: "installed" } },
  ]);
  expect(output).toBe(
    [
      "Theme: fixture",
      "  Layout: alpha",
      "    Slots:",
      "      - default",
      "      - left",
      "      - right",
      "  Layout: zeta",
      "    Slots: (none)",
    ].join("\n"),
  );
  expect(output).not.toContain("/private/");
});

test("executeInspectThemeCommand returns only the stable JSON projection", async () => {
  const operations = {
    resolveProjectRoot() {
      return "/project";
    },
    async resolveDeckupThemeLayouts() {
      return {
        name: "fixture",
        filePath: "/private/theme/package.json",
        packageName: "@private/theme",
        packageRoot: "/private/theme",
        layoutsDir: "/private/theme/layouts",
        layouts: [
          {
            id: "cover",
            filePath: "/private/theme/layouts/cover.astro",
            importPath: "/@fs/private/theme/layouts/cover.astro",
            hasDefaultSlot: true,
            slotNames: [],
          },
        ],
        slotNames: [],
        source: "package" as const,
      };
    },
  } as unknown as DeckupInspectThemeCommandOperations;

  const output = await executeInspectThemeCommand({ themeName: "fixture", json: true }, operations);
  expect(JSON.parse(output)).toEqual({
    theme: "fixture",
    layouts: [{ id: "cover", slots: ["default"] }],
  });
  expect(output).not.toMatch(/filePath|packageRoot|layoutsDir|importPath|source|private/);
});

test("inspect commands expose nested theme arguments", () => {
  expect(inspectCommand.name).toBe("inspect");
  expect(inspectCommand.subCommands).toMatchObject({ theme: inspectThemeCommand });
  expect(inspectThemeCommand.args.themeName.required).toBe(true);
  expect(inspectThemeCommand.args.json.default).toBe(false);
});

test("CLI inspect parent prints discoverable help exactly once", () => {
  const result = runCli(["inspect"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.match(/^USAGE:$/gm)).toHaveLength(1);
  expect(result.stdout).toContain("theme");
});

test("CLI inspect theme emits parseable built-in JSON without internal paths", () => {
  const result = runCli(["inspect", "theme", "default", "--json"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const inspection = JSON.parse(result.stdout) as {
    theme: string;
    layouts: Array<{ id: string; slots: string[] }>;
  };
  expect(Object.keys(inspection)).toEqual(["theme", "layouts"]);
  expect(inspection.theme).toBe("default");
  const layoutIds = inspection.layouts.map((layout) => layout.id);
  expect(layoutIds).toEqual([...layoutIds].sort());
  expect(inspection.layouts.find((layout) => layout.id === "two-column")?.slots).toEqual([
    "default",
    "left",
    "right",
  ]);
  expect(result.stdout).not.toMatch(/\/@fs\/|packageRoot|layoutsDir|filePath/);
});

test("CLI inspect theme resolves an installed package from the current project", async () => {
  await withCliProject(async (projectRoot) => {
    await writeInspectThemePackage(projectRoot, "@acme/inspect-theme", {
      "zeta.astro": '<slot name="right" /><slot /><slot name="left" />',
      "alpha.astro": '<slot name="beta" /><slot name="default" /><slot name="alpha" />',
    });
    const result = runCli(["inspect", "theme", "@acme/inspect-theme", "--json"], projectRoot);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      theme: "@acme/inspect-theme",
      layouts: [
        { id: "alpha", slots: ["default", "alpha", "beta"] },
        { id: "zeta", slots: ["default", "left", "right"] },
      ],
    });
  });
});

test("CLI inspect failures keep stdout empty and exit non-zero", async () => {
  await withCliProject(async (projectRoot) => {
    await writeInspectThemePackage(projectRoot, "broken-inspect-theme", {
      "a-valid.astro": "<slot />",
      "z-broken.astro": "<slot",
    });
    const cases: Array<[string[], RegExp]> = [
      [["inspect", "theme"], /themeName|Positional argument.*required/],
      [["inspect", "theme", "missing-inspect-theme", "--json"], /Unable to resolve/],
      [
        ["inspect", "theme", "npm:@acme/inspect-theme", "--json"],
        /only supports built-in themes and installed packages/,
      ],
      [["inspect", "theme", "broken-inspect-theme", "--json"], /Failed to parse/],
    ];
    for (const [args, errorPattern] of cases) {
      const result = runCli(args, projectRoot);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(errorPattern);
    }
  });
}, 30_000);

test("normalizeLogLevel accepts known Astro log levels", () => {
  expect(normalizeLogLevel("debug")).toBe("debug");
  expect(normalizeLogLevel("silent")).toBe("silent");
});

test("normalizeLogLevel falls back to info", () => {
  expect(normalizeLogLevel("verbose")).toBe("info");
  expect(normalizeLogLevel(undefined)).toBe("info");
});

test("normalizeOpenValues preserves selected deck file and omitted port for config resolution", () => {
  expect(normalizeOpenValues({ deckFile: "slides/talk.astro" })).toEqual({
    deckFile: "slides/talk.astro",
    host: DEFAULT_DEV_HOST,
    port: undefined,
    open: false,
    logLevel: "info",
  });
});

test("normalizeOpenValues leaves deck validation to the runtime config path", () => {
  expect(normalizeOpenValues({}).deckFile).toBeUndefined();
});

test("normalizeBuildFormat accepts supported output formats and defaults to pdf", () => {
  expect(normalizeBuildFormat(undefined)).toBe("pdf");
  expect(normalizeBuildFormat("pdf")).toBe("pdf");
  expect(normalizeBuildFormat("html")).toBe("html");
  expect(normalizeBuildFormat("png")).toBe("png");
});

test("normalizeBuildFormat rejects unsupported output formats", () => {
  expect(() => normalizeBuildFormat("pptx")).toThrow(/Unsupported Deckup build format/);
});

test("normalizeBuildValues defaults to PDF output and preserves selected deck file", () => {
  expect(normalizeBuildValues({ deckFile: "slides/talk.mdx" })).toEqual({
    deckFile: "slides/talk.mdx",
    format: "pdf",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: undefined,
    force: false,
    slides: undefined,
    logLevel: "info",
  });
});

test("normalizeBuildValues maps html output to the requested output directory", () => {
  expect(
    normalizeBuildValues({ deckFile: "slides/talk.mdx", format: "html", out: "public-deck" }),
  ).toEqual({
    deckFile: "slides/talk.mdx",
    format: "html",
    outDir: "public-deck",
    out: undefined,
    force: false,
    slides: undefined,
    logLevel: "info",
  });
});

test("normalizeBuildValues defaults html output to the deck basename", () => {
  expect(normalizeBuildValues({ deckFile: "slides/talk.mdx", format: "html" })).toEqual({
    deckFile: "slides/talk.mdx",
    format: "html",
    outDir: "talk",
    out: undefined,
    force: false,
    slides: undefined,
    logLevel: "info",
  });
});

test("normalizeBuildValues maps pdf output to the PDF target and force flag", () => {
  expect(
    normalizeBuildValues({
      deckFile: "slides/talk.mdx",
      format: "pdf",
      out: "talk.pdf",
      force: true,
    }),
  ).toEqual({
    deckFile: "slides/talk.mdx",
    format: "pdf",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: "talk.pdf",
    force: true,
    slides: undefined,
    logLevel: "info",
  });
});

test("normalizeBuildValues accepts only boolean force values", () => {
  expect(normalizeBuildValues({ force: true }).force).toBe(true);
  expect(normalizeBuildValues({ force: "true" }).force).toBe(false);
});

test("normalizeBuildValues maps png output, selector, and ignored force to PNG options", () => {
  expect(
    normalizeBuildValues({
      deckFile: "slides/talk.mdx",
      format: "png",
      out: "talk-images",
      slides: "1,3-5",
      force: true,
    }),
  ).toEqual({
    deckFile: "slides/talk.mdx",
    format: "png",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: "talk-images",
    force: true,
    slides: "1,3-5",
    logLevel: "info",
  });
});

test("normalizeBuildValues preserves an explicitly empty PNG selector for strict validation", () => {
  expect(normalizeBuildValues({ format: "png", slides: "" }).slides).toBe("");
});

test("normalizeBuildValues rejects slides for HTML and PDF", () => {
  expect(() => normalizeBuildValues({ format: "html", slides: "1" })).toThrow(
    /only supported with --format png/,
  );
  expect(() => normalizeBuildValues({ format: "pdf", slides: "1" })).toThrow(
    /only supported with --format png/,
  );
});

test("executeBuildCommand returns only ordered absolute PNG paths and ignores force", async () => {
  const pngFiles = [
    join("/tmp", "images", "slide-001.png"),
    join("/tmp", "images", "slide-003.png"),
  ];
  let receivedOptions: unknown;
  const operations = {
    async buildDeck() {
      throw new Error("HTML build should not run");
    },
    async exportDeck() {
      throw new Error("PDF export should not run");
    },
    async assertCanWriteExportTarget() {
      throw new Error("PDF overwrite check should not run");
    },
    async exportDeckPng(options: unknown) {
      receivedOptions = options;
      return {
        outDir: "/tmp/dist",
        htmlFile: "/tmp/dist/index.html",
        pngDir: "/tmp/images",
        pngFiles,
        url: "http://127.0.0.1:4321/",
      };
    },
  } as unknown as DeckupBuildCommandOperations;

  const output = await executeBuildCommand(
    {
      deckFile: "slides/talk.mdx",
      format: "png",
      outDir: DEFAULT_BUILD_OUT_DIR,
      out: "images",
      force: true,
      slides: "1,3",
      logLevel: "debug",
    },
    operations,
  );
  expect(receivedOptions).toEqual({
    deckFile: "slides/talk.mdx",
    outDir: DEFAULT_BUILD_OUT_DIR,
    out: "images",
    slides: "1,3",
    logLevel: "silent",
  });
  expect(output).toBe(pngFiles.join("\n"));
});

test("normalizeBuildValues ignores legacy outDir and keeps PDF staging internal", () => {
  expect(normalizeBuildValues({ format: "pdf", outDir: "custom-dist" }).outDir).toBe(
    DEFAULT_BUILD_OUT_DIR,
  );
});

test("openCommand exposes the renamed preview command", () => {
  expect(openCommand.name).toBe("open");
  expect(openCommand.description).toContain("preview server");
  expect(openCommand.args.deckFile.required).toBe(true);
  expect(openCommand.args.port.short).toBe("p");
});

test("buildCommand exposes PNG output and selector options", () => {
  expect(buildCommand.name).toBe("build");
  expect(buildCommand.description).toContain("PNG");
  expect(buildCommand.args.format.default).toBe("pdf");
  expect(buildCommand.args.format.description).toContain("png");
  expect(buildCommand.args.out.description).toContain("png/html");
  expect(buildCommand.args.slides.description).toContain("1,3-5");
  expect(buildCommand.args.force.short).toBe("f");
  expect(buildCommand.args.logLevel.description).toContain("stdout");
});

test("runDeckup rejects slides outside PNG format before touching the deck", async () => {
  await expect(
    runDeckup(["build", "slides/missing.mdx", "--format", "html", "--slides", "1"]),
  ).rejects.toThrow(/only supported with --format png/);
});

test("legacy command exports are removed", () => {
  expect("devCommand" in commandModule).toBe(false);
  expect("exportCommand" in commandModule).toBe(false);
});

test("entry command advertises open, unified build, and theme inspection", async () => {
  expect(entryCommand.name).toBe("deckup");
  const output = await runDeckup([]);
  expect(output).toContain("deckup open <deck-file>");
  expect(output).toContain("deckup build <deck-file>");
  expect(output).toContain("--format html");
  expect(output).toContain("--format png");
  expect(output).toContain("deckup inspect theme <theme-name>");
  expect(output).not.toContain("deckup dev");
  expect(output).not.toContain("deckup export");
});
