// Launches Chrome for Testing (CfT) — driven through Playwright's Chromium
// automation client via `executablePath`, but NOT Playwright's own bundled
// Chromium binary — with the built (unpacked) extension loaded via a
// persistent context, and resolves the extension's runtime id from the
// background service worker target — never hardcoded, since CRXJS assigns a
// fresh id to each unpacked build's key-less manifest.
//
// Why CfT specifically, and not Playwright's bundled Chromium or branded
// Google Chrome: boards/project-backlog/46-verify-harness-on-chrome-for-testing.md
// and decisions/16-native-webmcp-client.md. In short — Playwright's bundled
// Chromium has no WebMCP compiled in at all (`document.modelContext` stays
// `undefined` under every relevant flag), and branded Chrome refuses
// `--load-extension` outright. CfT is the only build measured to satisfy
// both at once.
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VERIFY_OUT_PATH } from "./build.mjs";
import { resolveChromeForTesting } from "./chromeForTesting.mjs";

/**
 * @param {{ enableWebMcp?: boolean }} [options] `enableWebMcp` (default
 *   `true`) adds `--enable-features=WebMCP`. Set `false` to launch WITHOUT
 *   it — used by the "WebMCP unavailable" assertion in verify/run.mjs, which
 *   needs a real browser where `document.modelContext` is genuinely absent.
 */
export async function launchExtension({ enableWebMcp = true } = {}) {
  const { executablePath, buildId } = await resolveChromeForTesting();
  const userDataDir = mkdtempSync(path.join(tmpdir(), "webmcp-verify-"));

  const args = [
    `--disable-extensions-except=${VERIFY_OUT_PATH}`,
    `--load-extension=${VERIFY_OUT_PATH}`,
    "--no-first-run",
  ];
  if (enableWebMcp) {
    // WebMCP is off by default in Chrome (decisions/16) — this is what
    // actually turns on `document.modelContext` for CfT builds that have it
    // compiled in, mirroring how a real user would enable
    // chrome://flags/#enable-webmcp-testing.
    args.push("--enable-features=WebMCP");
  }

  // MV3 extensions require a headed (or Chrome's "new" headless) launch;
  // headed is the reliable option here and this environment has a display.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath,
    args,
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  const match = sw.url().match(/^chrome-extension:\/\/([a-z]+)\//);
  if (!match) {
    throw new Error(`could not parse extension id from service worker url: ${sw.url()}`);
  }
  const extensionId = match[1];

  return {
    context,
    extensionId,
    userDataDir,
    buildId,
    async close() {
      await context.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export function sidepanelUrl(extensionId) {
  return `chrome-extension://${extensionId}/src/sidepanel/index.html`;
}

/** The options page, as `options_page` in manifest.config.ts declares it. Opened as an ordinary tab by verify/checks/screenshots.mjs — there is nothing extension-specific about how Chrome renders it, so a plain navigation is the real thing. */
export function optionsUrl(extensionId) {
  return `chrome-extension://${extensionId}/src/options/index.html`;
}
