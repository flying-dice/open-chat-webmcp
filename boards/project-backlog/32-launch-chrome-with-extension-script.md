---
column: review
labels: [infra]
priority: low
agent: claude
updatedAt: 2026-08-19T20:55:00.000Z
---
# Launch Chrome with the extension for hands-on use

Every existing way to run this extension is either fully manual (`npm run
build` then load unpacked via `chrome://extensions` by hand) or automated but
throwaway (`npm run verify`, which launches Playwright's bundled Chromium
against a temp profile purely to assert behaviour, then tears it all down).
There's nothing in between: a one-command way to get the extension loaded in
a real, persistent browser session for actually chatting with it against a
real local Ollama and real sites.

Added `npm run launch` (`scripts/launch-chrome.mjs`), which rebuilds `dist/`,
finds the user's real installed Chrome, and opens it against a dedicated
persistent profile (`.chrome-profile/`, gitignored) so logins and provider
settings survive between runs — unlike `npm run verify`'s throwaway temp
profile, which is correct for that harness but useless for this.

**Real Chrome cannot be driven the way `npm run verify` drives Chromium.**
While building this, real Google Chrome turned out to flatly refuse the
`--load-extension` command-line flag that `verify/lib/browser.mjs` relies on
— it logs `--load-extension is not allowed in Google Chrome, ignoring.` and
loads nothing. That flag only works on Chromium / "Chrome for Testing"
builds (confirmed by literally running the same flags against Playwright's
bundled "Chrome for Testing" binary in the same persistent profile — it
loaded fine there). This is a deliberate Google restriction to stop malware
side-loading extensions into people's real browsers, not a bug in this
script or a gap in `npm run verify`. See the journal for the full trail.

## Checklist

- [x] Locate real Chrome (not Playwright's Chromium) on macOS, with a clear failure message if not found
- [x] Dedicated, persistent, gitignored profile directory — not a temp dir
- [x] Always rebuild `dist/` before launching so the loaded build is never stale
- [x] Open something useful on start (demo fixture page on repeat runs; `chrome://extensions/` with instructions on the first run, since a fresh profile has no way to load the extension automatically — see journal)
- [x] Print plain instructions for opening the side panel (MV3 can't do it programmatically)
- [x] Document the script in README.md alongside `npm run demo` / `npm run verify`
- [x] Confirm `npm run verify` still passes 9/9 (verify harness untouched)
- [x] Actually run the script and observe Chrome open with the right profile/flags against `dist/`

## Comments

- **claude** (2026-08-19T18:06:45.000Z): Claimed the card, starting work.
- **claude** (2026-08-19T18:23:00.000Z): Built `scripts/launch-chrome.mjs`, wired `npm run launch` (`package.json:12`), gitignored the profile dir (`.gitignore:12-17`), and documented it in `README.md` in a new "Launch it in real Chrome" section ahead of "Verification harness". First real run surfaced a genuine platform constraint I hadn't assumed going in: real Google Chrome (Version 151 on this machine) hard-refuses `--load-extension` — confirmed via Chrome's own `chrome_debug.log` line `--load-extension is not allowed in Google Chrome, ignoring.` (reproduced with `--enable-logging=stderr`). I proved the split empirically: launching Playwright's own "Chrome for Testing" binary (`chromium.executablePath()`) against the exact same `.chrome-profile/` with `--load-extension`/`--disable-extensions-except` loaded the extension fine (service worker `chrome-extension://jmboakgndncopiegjdaofbnnohbjldig/service-worker-loader.js` came up); relaunching plain real Chrome against that *same, already-populated* profile with no special flags still showed zero extensions in `chrome://extensions` — real Chrome doesn't even trust a persisted registration that originated from the command-line-load path, not just the flag itself. So `verify/lib/browser.mjs:15-22`'s approach (correct and left untouched) cannot be reused as-is for real Chrome. Redesigned `scripts/launch-chrome.mjs` around this: `findChrome()` locates the real binary (macOS/Linux/Windows candidate paths, `CHROME_PATH` override), `build()` always rebuilds `dist/` via `npm run build`, and `main()` checks whether `.chrome-profile/` already existed *before* this run — first run opens `chrome://extensions/` and prints the one-time manual steps (enable Developer mode, click "Load unpacked", pick `dist/`); every run after that starts/reuses the demo server (reusing `verify/lib/demoServer.mjs`'s `startDemoServer` unmodified) and opens `http://localhost:5175/index.html` instead, since Chrome remembers an unpacked extension for a profile once it's been loaded via the UI. Verified for real: ran `node scripts/launch-chrome.mjs` fresh — it built, created `.chrome-profile/`, and launched real Chrome (`ps` confirmed the exact command line: `--user-data-dir=.../.chrome-profile --no-first-run --no-default-browser-check chrome://extensions/`, no `--load-extension`) landing on the extensions tab as designed. I could not fully script-drive the native "Load unpacked" file-picker dialog to get a hands-off proof that the *manual* UI flow persists across restarts in this remote desktop (got as far as confirming a real trusted click opened the native `com.apple.appkit.xpc.openAndSavePanelService` panel, but couldn't reliably complete the keystroke-driven folder selection here) — that specific mechanism is otherwise the same one this project's own README (`README.md:53-58`, pre-existing, unchanged) has always documented as the standard way to load this extension by hand, so it isn't a new risk, just a manual step I narrated rather than fully automated end-to-end. Ran the required gates after all this: `npm run check` (0 errors, 137 files), `npm run build`, and `npm run verify` all green, verify at 9/9 including the best-effort screenshot check — confirms none of this touched or weakened `verify/`.
- **claude** (2026-08-19T20:55:00.000Z): Follow-up: the first-run help message now also points the user at Chrome's own WebMCP flag, per decision `decisions/02-mainworld-webmcp-bridge.md` — worded as optional, since the extension's adopt-or-provide shim already provides `navigator.modelContext` when Chrome doesn't have a native one, so pages work either way; the flag only matters for exercising Chrome's *native* implementation (the shim's "adopt" branch in `src/inject/bridge.ts`) instead of the shim. Found the real flag id rather than guessing: `enable-webmcp-testing` ("WebMCP for testing"), confirmed present by `strings`-searching the installed Google Chrome 151.0.7922.138 Framework binary directly (`/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/151.0.7922.138/Google Chrome Framework`), which also matched what web search turned up (Chrome 149+ origin trial). Anchored URL `chrome://flags/#enable-webmcp-testing` in `scripts/launch-chrome.mjs:67-73`. Verified Chrome accepts two `chrome://` URLs as separate positional start-page args (tested against a throwaway profile first, then confirmed again via a real run — `ps` showed both `chrome://extensions/` and `chrome://flags/#enable-webmcp-testing` on the launched process's command line, no errors attributable to it), so first run now opens both tabs at once: `scripts/launch-chrome.mjs:148-161`. Added the optional-flag explanation as a second `console.log` block in the first-run branch, `scripts/launch-chrome.mjs:179-189`, worded to degrade gracefully (tells the user to search "webmcp" on `chrome://flags` if the id has moved, since WebMCP is still shipping behind flags/an origin trial). Mirrored the same addition in `README.md`: a new optional step 5 in "Build and load it" (`README.md:53-64`) and a new paragraph in "Launch it in real Chrome" (`README.md:207-219`) so the two don't drift. To verify the first-run message actually renders as intended without disturbing the real profile, I moved `.chrome-profile/` aside to `.chrome-profile.bak-testrun`, ran `node scripts/launch-chrome.mjs` for real (rebuilt `dist/`, launched real Chrome, printed the message, confirmed via `ps` that both start URLs were on the command line), then killed only that freshly-spawned Chrome process tree, deleted the freshly-created test profile, and moved the backup back to `.chrome-profile/` — the user's real profile is intact. Re-ran all three required gates after: `npm run check` (0 errors, 137 files), `npm run build` (clean), `npm run verify` (9/9, including the best-effort screenshot check) — all green.

