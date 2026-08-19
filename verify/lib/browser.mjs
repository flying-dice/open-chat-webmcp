// Launches Chromium with the built (unpacked) extension loaded via a
// persistent context, and resolves the extension's runtime id from the
// background service worker target — never hardcoded, since CRXJS assigns a
// fresh id to each unpacked build's key-less manifest.
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VERIFY_OUT_PATH } from "./build.mjs";

export async function launchExtension() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "webmcp-verify-"));
  // MV3 extensions require a headed (or Chrome's "new" headless) launch;
  // headed is the reliable option here and this environment has a display.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${VERIFY_OUT_PATH}`,
      `--load-extension=${VERIFY_OUT_PATH}`,
      "--no-first-run",
    ],
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
    async close() {
      await context.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export function sidepanelUrl(extensionId) {
  return `chrome-extension://${extensionId}/src/sidepanel/index.html`;
}
