// Resolves (and, on first run, installs) Chrome for Testing (CfT) — the only
// Chrome-family build measured to satisfy BOTH requirements the verify
// harness needs at once (decisions/16-native-webmcp-client.md,
// boards/project-backlog/46-verify-harness-on-chrome-for-testing.md):
//
//   - `--load-extension` is honoured. Branded Google Chrome refuses it
//     outright ("--load-extension is not allowed in Google Chrome, ignoring"
//     — scripts/launch-chrome.mjs:10-11).
//   - `document.modelContext` actually exists under `--enable-features=WebMCP`.
//     Playwright's bundled Chromium does NOT have WebMCP compiled in at all
//     (verified on 151.0.7922.34: stays `undefined` under every flag
//     combination tried).
//
// Resolved programmatically via `@puppeteer/browsers` (the same package
// `npx @puppeteer/browsers install chrome@stable` uses) rather than a
// hardcoded version or absolute path, and cached in a gitignored directory
// at the repo root so repeat runs don't re-download. Never silently falls
// back to a different browser — if CfT can't be resolved or installed, this
// throws with an actionable message instead of letting the caller launch a
// browser with no WebMCP support.

import {
  Browser,
  ChromeReleaseChannel,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const CACHE_DIR = path.join(ROOT, ".chrome-for-testing");

/**
 * Resolves a working Chrome for Testing executable, downloading it into
 * {@link CACHE_DIR} the first time this runs (or after a cache wipe).
 * Always resolves the current "stable" build id at call time — this was
 * measured end to end against 152.0.7977.54, but nothing here hardcodes
 * that version, so the harness tracks whatever Chrome for Testing currently
 * publishes as stable.
 *
 * @returns {Promise<{ executablePath: string, buildId: string, platform: string }>}
 */
export async function resolveChromeForTesting() {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(
      "verify: could not detect a Chrome for Testing platform for this machine (unsupported OS/CPU " +
        "architecture for @puppeteer/browsers). npm run verify requires Chrome for Testing — see " +
        "decisions/16-native-webmcp-client.md and " +
        "boards/project-backlog/46-verify-harness-on-chrome-for-testing.md.",
    );
  }

  let buildId;
  try {
    buildId = await resolveBuildId(Browser.CHROME, platform, ChromeReleaseChannel.STABLE);
  } catch (err) {
    throw new Error(
      "verify: could not resolve the current Chrome for Testing \"stable\" build id (this needs network " +
        `access on first run, or after a version bump): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const executablePath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CACHE_DIR,
    platform,
  });

  if (existsSync(executablePath)) {
    return { executablePath, buildId, platform };
  }

  console.log(`Chrome for Testing ${buildId} (${platform}) not found in ${CACHE_DIR} — downloading (first run only)...`);
  let installed;
  try {
    installed = await install({
      browser: Browser.CHROME,
      buildId,
      cacheDir: CACHE_DIR,
      platform,
      unpack: true,
    });
  } catch (err) {
    throw new Error(
      `verify: failed to download/install Chrome for Testing ${buildId} for ${platform}: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "npm run verify REQUIRES Chrome for Testing (decisions/16-native-webmcp-client.md) — Playwright's " +
        "bundled Chromium has no WebMCP support and branded Google Chrome refuses --load-extension. " +
        `You can install it yourself with: npx @puppeteer/browsers install chrome@stable --path ${CACHE_DIR}`,
    );
  }

  if (!existsSync(installed.executablePath)) {
    throw new Error(
      `verify: Chrome for Testing install reported success but no executable exists at ` +
        `${installed.executablePath}. Try deleting ${CACHE_DIR} and re-running npm run verify.`,
    );
  }

  return { executablePath: installed.executablePath, buildId, platform };
}
