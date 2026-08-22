#!/usr/bin/env node
// CI-only helper for .github/workflows/ci.yml's verify job.
//
// verify/lib/chromeForTesting.mjs's resolveChromeForTesting() does not pin a
// Chrome for Testing (CfT) build id anywhere — it resolves whatever the CfT
// "stable" channel currently publishes at call time (see that file's header
// comment) and installs it into .chrome-for-testing/ (gitignored) on first
// use. There is nothing to key an actions/cache step on ahead of time.
//
// This script runs the exact same resolve call (detectBrowserPlatform +
// resolveBuildId against Browser.CHROME/ChromeReleaseChannel.STABLE) WITHOUT
// installing anything, purely so the workflow can learn the current stable
// build id *before* restoring the cache — giving actions/cache a precise,
// version-scoped key (`cft-<platform>-<buildId>`) instead of a vague one.
// When CfT ships a new stable build the key changes, the cache step misses,
// and `npm run verify`'s own resolveChromeForTesting() call downloads and
// populates the cache for next time — exactly the behaviour a developer
// gets locally, just made cacheable in CI too.
//
// Deliberately lives under .github/, not scripts/ (card 109 owns .github/**
// only; scripts/ is card 110's) — this is CI plumbing, not a project script,
// and is never invoked outside the workflow.
import { Browser, ChromeReleaseChannel, detectBrowserPlatform, resolveBuildId } from "@puppeteer/browsers";

const platform = detectBrowserPlatform();
if (!platform) {
  console.error(
    "resolve-cft-build-id: could not detect a Chrome for Testing platform for this runner " +
      "(unsupported OS/CPU architecture for @puppeteer/browsers).",
  );
  process.exit(1);
}

let buildId;
try {
  buildId = await resolveBuildId(Browser.CHROME, platform, ChromeReleaseChannel.STABLE);
} catch (err) {
  console.error(
    `resolve-cft-build-id: could not resolve the current Chrome for Testing "stable" build id: ` +
      `${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

// GITHUB_OUTPUT lines — the workflow step appends this script's stdout
// directly into $GITHUB_OUTPUT.
console.log(`build_id=${buildId}`);
console.log(`platform=${platform}`);
