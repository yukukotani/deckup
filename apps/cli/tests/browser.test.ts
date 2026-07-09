import { Browser, BrowserPlatform } from "@puppeteer/browsers";
import { expect, test } from "vite-plus/test";

import { installChromiumWithCacheRepair } from "../src/browser.ts";

test("installChromiumWithCacheRepair deletes a corrupt cached Chrome before retrying", async () => {
  const calls: string[] = [];
  const options = {
    browser: Browser.CHROME,
    buildId: "123.0.0.0",
    cacheDir: "/tmp/deckup-browser-cache",
    platform: BrowserPlatform.MAC_ARM,
  };

  await installChromiumWithCacheRepair(options, {
    async install(receivedOptions) {
      calls.push(`install:${receivedOptions.buildId}`);
      if (calls.length === 1) {
        throw new Error(
          "The browser folder (/tmp/deckup-browser-cache/chrome/mac_arm-123.0.0.0) exists but the executable (/tmp/deckup-browser-cache/chrome/mac_arm-123.0.0.0/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing) is missing",
        );
      }
    },
    async uninstall(receivedOptions) {
      calls.push(`uninstall:${receivedOptions.buildId}`);
    },
  });

  expect(calls).toEqual(["install:123.0.0.0", "uninstall:123.0.0.0", "install:123.0.0.0"]);
});

test("installChromiumWithCacheRepair preserves non-cache-corruption install failures", async () => {
  const error = new Error("network unavailable");
  const options = {
    browser: Browser.CHROME,
    buildId: "123.0.0.0",
    cacheDir: "/tmp/deckup-browser-cache",
    platform: BrowserPlatform.MAC_ARM,
  };

  await expect(
    installChromiumWithCacheRepair(options, {
      async install() {
        throw error;
      },
      async uninstall() {
        throw new Error("uninstall should not run");
      },
    }),
  ).rejects.toThrow(error);
});
