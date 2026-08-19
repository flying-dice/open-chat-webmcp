#!/usr/bin/env node
// npm run launch — builds the extension and opens it in the user's REAL,
// installed Chrome (not the Chrome for Testing build `npm run verify` uses,
// deliberately, for deterministic testing) so it can actually be used by
// hand against real sites and a real local Ollama.
// See boards/project-backlog/32-launch-chrome-with-extension-script.md.
//
// IMPORTANT, discovered while building this: real Google Chrome (the
// consumer/Stable-channel app almost everyone has installed) REFUSES the
// --load-extension command-line flag outright. It logs, verbatim:
//   --load-extension is not allowed in Google Chrome, ignoring.
// and loads nothing — silently, from the outside. That flag only works on
// Chromium / "Chrome for Testing" builds, which is exactly what
// `npm run verify` launches (decisions/16-native-webmcp-client.md), and why
// THAT harness can fully automate loading the extension end to end. There's
// no command-line way around this for real Chrome short of enterprise device
// policy — Google restricts it specifically to stop malware from silently
// side-loading extensions into people's real browsers. So this script does
// the one thing it actually can on a brand-new profile: open
// chrome://extensions/ with plain instructions, and the user clicks
// "Load unpacked" once, by hand. That's a genuine one-time step this script
// cannot script around, not a limitation of this script.
//
// The upside: Chrome remembers an unpacked extension for the profile it was
// loaded into, across restarts, as long as it's the same dist/ path — so
// every `npm run launch` after the first one opens straight into a working
// extension with no further manual steps.
//
// Other design decisions (see the card's journal for the full reasoning):
//  - Real Chrome, located from the standard per-OS install paths, with a
//    CHROME_PATH override for anything nonstandard. If it can't be found,
//    fail with a clear message rather than silently falling back to a
//    Chromium the user didn't ask for.
//  - A DEDICATED, PERSISTENT profile directory (.chrome-profile/, gitignored)
//    rather than a throwaway temp dir. Chrome refuses to load an unpacked
//    extension into your everyday default profile while it's running, and a
//    fresh profile every launch would throw away logins, provider settings,
//    AND the one-time "Load unpacked" registration above on every run,
//    defeating the point of hands-on testing.
//  - Always rebuilds into dist/ before launching, so what loads is always
//    exactly what's in the working tree right now, never a stale build from
//    a previous session. (If Chrome shows the extension as needing a
//    reload afterwards, click the refresh icon on its chrome://extensions
//    card — same manual step already documented in README.md for the
//    plain "Load unpacked" workflow.)
//  - On every run after the first, starts (or reuses) the demo WebMCP
//    fixture server on :5175 and opens it, because it's an immediately
//    useful page with real tools to try the extension against — never
//    opens a tab pointing at a port nothing is listening on. Falls back to
//    a blank tab with a printed warning if the demo server can't be
//    started.
//  - Launches detached and returns control of the terminal immediately, the
//    same way double-clicking the app would — this is for an interactive
//    session that may run for a while, not something that should hold a
//    terminal hostage.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDemoServer, DEMO_INDEX_URL } from "../verify/lib/demoServer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_PATH = path.join(ROOT, "dist");
const PROFILE_DIR = path.join(ROOT, ".chrome-profile");

// Anchored so it jumps straight to the toggle instead of a bare
// chrome://flags the user has to search. Confirmed present, under this
// exact id, in Google Chrome 151.0.7922.138 (macOS) via strings on the
// Chrome Framework binary — display name "WebMCP for testing". WebMCP is
// still shipping behind flags/an origin trial, so this id can move or
// disappear in a future Chrome version; the first-run message below is
// worded to degrade gracefully if that happens.
const WEBMCP_FLAG_ID = "enable-webmcp-testing";
const WEBMCP_FLAGS_URL = `chrome://flags/#${WEBMCP_FLAG_ID}`;

// decisions/16-native-webmcp-client.md: native WebMCP is now a HARD
// requirement, not a nice-to-have — nothing this extension does works
// without document.modelContext existing. Passing this switch directly is
// one of the three enablement paths decisions/16 documents (alongside the
// chrome://flags toggle and a per-origin origin-trial token), and unlike
// --load-extension, real branded Chrome does honour --enable-features on
// the command line, so this makes every `npm run launch` work without the
// manual flags-page step below — that step is kept only as a fallback for
// when this switch is blocked (e.g. enterprise policy) or the feature name
// changes.
const WEBMCP_CHROME_ARG = "--enable-features=WebMCP";

// Standard Chrome (not Chromium, not Canary/Beta) install locations per OS.
// This machine is darwin, so that's the well-tested path; linux/win32 paths
// are included as a best-effort courtesy but not verified here.
const CANDIDATE_PATHS = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(process.env.HOME ?? "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

function findChrome() {
  if (process.env.CHROME_PATH) {
    if (existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    console.error(`CHROME_PATH is set to "${process.env.CHROME_PATH}" but nothing exists there.`);
    process.exit(1);
  }
  const candidates = CANDIDATE_PATHS[process.platform] ?? [];
  const found = candidates.find((p) => p && existsSync(p));
  if (found) return found;
  console.error(
    `Could not find a real Google Chrome install.${candidates.length ? " Checked:\n" + candidates.map((p) => `  - ${p}`).join("\n") : " No known install locations for this platform (" + process.platform + ")."}\n` +
      "Install Chrome, or set CHROME_PATH to its executable, then re-run `npm run launch`.",
  );
  process.exit(1);
}

// Best-effort detection of whether the profile already has the flag toggled
// on by hand, purely so the message printed every run can say something
// more useful than "we don't know." Chrome stores enabled chrome://flags
// experiments in this profile's "Local State" file (JSON) under
// browser.enabled_labs_experiments, an undocumented but long-stable format
// that browser-automation tooling has relied on for years. Some flags store
// the choice as "<id>@<n>" (a specific option out of a set) rather than the
// bare id, hence startsWith rather than an exact match. Never throws: a
// missing/malformed file (fresh profile, format change) just reads as "not
// detected," which only affects wording, not behaviour — the extension
// still gets launched with WEBMCP_CHROME_ARG regardless.
function isWebMcpFlagEnabledInProfile() {
  try {
    const state = JSON.parse(readFileSync(path.join(PROFILE_DIR, "Local State"), "utf8"));
    const experiments = state?.browser?.enabled_labs_experiments ?? [];
    return experiments.some((id) => typeof id === "string" && id.startsWith(WEBMCP_FLAG_ID));
  } catch {
    return false;
  }
}

function build() {
  console.log("Building extension -> dist/ (always rebuilt on launch, so this is never stale) ...");
  const res = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) {
    console.error("Build failed; not launching Chrome.");
    process.exit(res.status ?? 1);
  }
  console.log("Build OK.");
}

async function openDemoPage() {
  try {
    const demoHandle = await startDemoServer();
    if (!demoHandle.alreadyRunning) demoHandle.proc.unref();
    console.log(
      demoHandle.alreadyRunning
        ? `Demo server already running on :5175 — opening ${DEMO_INDEX_URL}.`
        : `Started the demo server in the background on :5175 — opening ${DEMO_INDEX_URL}. ` +
          "It's a real WebMCP fixture page (read-only, mutating, throwing and hanging tools) to try the " +
          "extension against immediately. It keeps running after this script exits — stop it later with " +
          "`lsof -ti:5175 | xargs kill` if you don't want it lingering.",
    );
    return DEMO_INDEX_URL;
  } catch (err) {
    console.warn(`Could not start the demo server (${err.message}); opening a blank tab instead.`);
    return "about:blank";
  }
}

async function main() {
  const chromePath = findChrome();
  build();

  // A profile that doesn't exist yet means the one-time "Load unpacked"
  // step (see the file header) has never been done for it — Chrome can't
  // be driven through that by this script, so send the user straight to
  // chrome://extensions/ instead of a demo page they can't do anything
  // useful with yet.
  const isFirstRun = !existsSync(PROFILE_DIR);
  mkdirSync(PROFILE_DIR, { recursive: true });

  // First run opens two tabs: chrome://extensions/ (the manual "Load
  // unpacked" step below) and chrome://flags at the WebMCP flag — a manual
  // FALLBACK now, not the primary enablement path, since WEBMCP_CHROME_ARG
  // below is passed on every launch. Chrome accepts multiple chrome:// URLs
  // as separate positional start-page args; verified directly (ps showed
  // both on the launched process's command line, both tabs present, no
  // errors attributable to it).
  const startUrls = isFirstRun ? ["chrome://extensions/", WEBMCP_FLAGS_URL] : [await openDemoPage()];
  const webMcpAlreadyEnabled = isWebMcpFlagEnabledInProfile();

  const child = spawn(
    chromePath,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      WEBMCP_CHROME_ARG,
      ...startUrls,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  console.log(
    `\nChrome launched with profile: ${PROFILE_DIR}\n` +
      "(gitignored, reused every launch — logins, provider settings, and the loaded extension all survive between runs)",
  );

  // Printed on EVERY run, not just the first — decisions/16-native-webmcp-client.md
  // made native WebMCP a HARD requirement, so treating it as a one-time,
  // skippable nicety (the old wording) would leave every subsequent launch
  // silently non-functional if the command-line switch doesn't take for some
  // reason (enterprise policy, a renamed feature flag in a future Chrome).
  console.log(
    webMcpAlreadyEnabled
      ? `\nWebMCP: launching with ${WEBMCP_CHROME_ARG}, and this profile's flags also already show\n` +
          `"${WEBMCP_FLAG_ID}" enabled — belt and suspenders, WebMCP should be available.`
      : `\nWebMCP: launching with ${WEBMCP_CHROME_ARG} (required — nothing this extension does works without\n` +
          `document.modelContext existing; see docs/02-webmcp-compatibility.md). This profile's flags file doesn't\n` +
          `show "${WEBMCP_FLAG_ID}" toggled on by hand, but that switch should enable it independently. If the\n` +
          'side panel still reports "WebMCP isn\'t available" after this launch, turn the flag on manually at\n' +
          `${WEBMCP_FLAGS_URL} (search "webmcp" on chrome://flags if that id has moved) and relaunch, or visit a\n` +
          "page carrying a WebMCP origin-trial token instead — see docs/02-webmcp-compatibility.md.",
  );

  if (isFirstRun) {
    console.log(
      "\nFIRST RUN — real Google Chrome refuses to auto-load unpacked extensions from the command line (it logs\n" +
        '"--load-extension is not allowed in Google Chrome, ignoring." and does nothing — a deliberate Chrome\n' +
        "restriction, not a bug here). One-time manual setup, on the chrome://extensions tab that just opened:\n" +
        '  1. Turn on "Developer mode" (top right).\n' +
        '  2. Click "Load unpacked" and select:\n' +
        `       ${DIST_PATH}\n` +
        "Chrome remembers this for this profile, so every `npm run launch` after this one loads it automatically\n" +
        "and opens straight into the demo page instead.",
    );
    console.log(
      "\nA second tab also opened, on chrome://flags, at the \"WebMCP for testing\" flag. This is a FALLBACK, not\n" +
        "the primary path — every launch already passes " +
        WEBMCP_CHROME_ARG +
        " on the command line (see the WebMCP\n" +
        "message above), which should enable document.modelContext without touching this tab at all. Use it by\n" +
        "hand only if the switch doesn't take for some reason (enterprise policy, or a future Chrome dropping the\n" +
        "feature flag). WebMCP is still shipping behind flags/an origin trial, so this flag's id and name can\n" +
        'change between Chrome versions; if it isn\'t on the tab that opened, search "webmcp" on chrome://flags to\n' +
        "find its current name.",
    );
  } else {
    console.log(`\nOpened ${startUrls[0]}.`);
  }

  console.log(
    "\nMV3 side panels cannot be opened programmatically, so nothing will pop up on its own: " +
      "click the extension's toolbar icon to open the OpenChat side panel " +
      "(pin it first from the puzzle-piece/extensions menu in the toolbar if it isn't visible).",
  );
}

main().catch((err) => {
  console.error("launch failed:", err);
  process.exit(1);
});
