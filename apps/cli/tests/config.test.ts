import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createAstroInlineConfig, createSlidaAstroConfig, DEFAULT_DEV_PORT } from "../src/astro.ts";
import { loadSlidaConfig } from "../src/config.ts";
import type { SlidaRuntimePaths } from "../src/types.ts";

async function withProjectRoot(run: (projectRoot: string) => Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "slida-config-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

function testPaths(projectRoot = resolve("/tmp/slida-project")): SlidaRuntimePaths {
  return {
    projectRoot,
    runtimeSourceDir: join(projectRoot, "node_modules/@slida/cli/runtime"),
    runtimeOutDir: join(projectRoot, ".slida/runtime"),
  };
}

function serverPort(config: ReturnType<typeof createAstroInlineConfig>) {
  return (config.server as { port?: number } | undefined)?.port;
}

test("loadSlidaConfig loads a project-root TypeScript config", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");

    await expect(loadSlidaConfig(projectRoot)).resolves.toMatchObject({
      config: { port: 3000 },
      filePath: join(projectRoot, "slida.config.ts"),
    });
  });
});

test("loadSlidaConfig returns an empty config when no config file exists", async () => {
  await withProjectRoot(async (projectRoot) => {
    await expect(loadSlidaConfig(projectRoot)).resolves.toEqual({ config: {} });
  });
});

test("loadSlidaConfig rejects multiple project-root config files", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");
    await writeFile(join(projectRoot, "slida.config.js"), "export default { port: 3001 };\n");

    await expect(loadSlidaConfig(projectRoot)).rejects.toThrow(/Multiple Slida config files found/);
  });
});

test("loadSlidaConfig rejects non-object config exports", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(
      join(projectRoot, "slida.config.ts"),
      "export default () => ({ port: 3000 });\n",
    );

    await expect(loadSlidaConfig(projectRoot)).rejects.toThrow(
      /Slida config must default-export an object/,
    );
  });
});

test("createSlidaAstroConfig uses config port when CLI/API port is omitted", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");

    const { astroConfig, slidaConfigFile } = await createSlidaAstroConfig({ root: projectRoot });

    expect(serverPort(astroConfig)).toBe(3000);
    expect(slidaConfigFile).toBe(join(projectRoot, "slida.config.ts"));
  });
});

test("explicit API port wins over config port", async () => {
  await withProjectRoot(async (projectRoot) => {
    await writeFile(join(projectRoot, "slida.config.ts"), "export default { port: 3000 };\n");

    const { astroConfig } = await createSlidaAstroConfig({ root: projectRoot, port: 3333 });

    expect(serverPort(astroConfig)).toBe(3333);
  });
});

test("no config preserves the default dev port", () => {
  const config = createAstroInlineConfig(testPaths());
  expect(serverPort(config)).toBe(DEFAULT_DEV_PORT);
});

test("no config does not install Tailwind as a built-in Vite plugin", () => {
  const config = createAstroInlineConfig(testPaths());
  expect(config.vite?.plugins).toEqual([]);
});

test("user Astro config appends without replacing Slida-owned values", () => {
  const paths = testPaths();
  const userIntegration = { name: "user-integration", hooks: {} } as never;
  const userPlugin = { name: "user-plugin" } as never;
  const config = createAstroInlineConfig(
    paths,
    {},
    {
      astro: {
        integrations: [userIntegration],
        vite: {
          root: join(paths.projectRoot, "other-root"),
          plugins: [userPlugin],
          resolve: {
            alias: [{ find: /^@slides$/, replacement: join(paths.projectRoot, "slides") }],
          },
          server: {
            fs: {
              strict: false,
              allow: [join(paths.projectRoot, "content")],
            },
          },
        },
      },
    },
  );

  expect(config.root).toBe(paths.projectRoot);
  expect(config.configFile).toBe(false);
  expect(config.srcDir).toBe(paths.runtimeOutDir);
  expect(config.output).toBe("static");
  expect(config.integrations?.at(-1)).toBe(userIntegration);
  expect(config.vite?.plugins?.at(-1)).toBe(userPlugin);
  expect(config.vite?.resolve?.alias).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ find: /^astro$/ }),
      expect.objectContaining({ find: /^@slides$/ }),
    ]),
  );
  expect(config.vite?.server?.fs?.allow).toEqual(
    expect.arrayContaining([
      paths.projectRoot,
      paths.runtimeOutDir,
      paths.runtimeSourceDir,
      join(paths.projectRoot, "content"),
    ]),
  );
  expect(config.vite?.server?.fs?.strict).toBe(true);
  expect((config.vite as { root?: unknown }).root).toBeUndefined();
});
