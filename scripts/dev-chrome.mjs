#!/usr/bin/env node
// npm run dev:chrome — the edit→see loop, in one command.
// boards/project-backlog/110-local-dev-workflow.md, docs/07-development.md.
//
// Starts three things and holds them together until you Ctrl-C:
//
//   1. Vite in DEV mode with @crxjs/vite-plugin, writing its dev-mode
//      extension stub into dist-dev/ (never dist/, never dist-verify/).
//   2. The demo WebMCP fixture server on :5175 (verify/lib/demoServer.mjs) —
//      reused if one is already up, so a concurrent `npm run verify` and this
//      script never fight over it.
//   3. Chrome for Testing with dist-dev/ ALREADY LOADED (`--load-extension`,
//      which only CfT honours — branded Chrome refuses it outright; see
//      scripts/launch-chrome.mjs, which is the real-Chrome fallback and needs
//      a one-time manual "Load unpacked").
//
// -- The reload mechanism, measured, not assumed (card 110) ---------------
//
// CRXJS 2.7's dev mode genuinely works for this MV3 setup, so there is NO
// watch-build and NO dev-only reload client compiled into the extension. What
// each kind of edit does, measured on Chrome for Testing 152:
//
//   * UI code (anything the side panel or options page imports) — the pages
//     are served from the Vite dev server through the EXTENSION'S OWN origin,
//     so `chrome.*` is real and Svelte HMR applies the edit in place.
//     Measured: ~0.5s from save to applied, with a page-level marker still
//     alive afterwards, i.e. genuinely hot, not a reload in disguise.
//   * src/background/**, src/content/**, manifest.config.ts — cannot be
//     hot-patched. CRXJS's answer is `chrome.runtime.reload()`, and THAT DOES
//     NOT WORK for an extension Chrome loaded from `--load-extension`:
//     measured, the extension does not come back — every extension URL then
//     fails with ERR_BLOCKED_BY_CLIENT and the open panel tab is dropped onto
//     chrome://new-tab-page. So CRXJS's live reload is turned OFF (the
//     `liveReload` option, via the CRX_LIVE_RELOAD env var vite.config.ts
//     reads) and this script RELAUNCHES THE BROWSER on those edits instead —
//     ~3s, and the profile is persistent, so storage, settings and the seeded
//     world all survive it.
//
// Either way there is no dev-only code in src/ and nothing to exclude from a
// production build: `vite build` never runs CRXJS's dev path at all.
//
// -- Ports, and not colliding with a concurrent harness run ----------------
//
// CRXJS bakes the CONFIGURED dev-server port into the extension it writes
// (its loading page and its service-worker loader both hardcode
// `http://localhost:<port>`), and it reads `config.server.port` — NOT the
// port Vite actually ended up on. So a Vite fallback to port+1 would produce
// an extension pointing at a dead port. This script therefore picks a free
// port ITSELF before starting Vite and pins it with `strictPort`, which also
// means two dev sessions (or a dev session next to anything else on 5173+)
// simply get different ports instead of clobbering each other.
//
// Everything else is likewise kept off the harness's toes: its own build
// directory (dist-dev/), its own persistent profile (.chrome-dev-profile/,
// gitignored), and a demo server it only starts if nothing is serving one.

import net from "node:net";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { launchExtension, optionsUrl, sidepanelUrl } from "../verify/lib/browser.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "../verify/lib/demoServer.mjs";
import { installPanelFixtureStubs, seedExtensionStorage } from "../verify/lib/seed.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_PROFILE_DIR = path.join(ROOT, ".chrome-dev-profile");
// 5173 is plain `npm run dev`; 5175 is the demo server. Start above both and
// walk up from there.
const DEFAULT_PORT = 5176;

/**
 * The dev build directory, DERIVED FROM THE PORT — `dist-dev/` for the usual
 * session, `dist-dev-<port>/` for any other. A second dev session that lands
 * on a different port therefore also gets a different build directory:
 * without this the two Vite servers write the same files and each one's
 * extension ends up pointing at the other's port. (It also needs its own
 * `--profile`; Chrome will not share a profile directory between two running
 * browsers, and says so.)
 */
function devOutDir(port) {
  return port === DEFAULT_PORT ? "dist-dev" : `dist-dev-${port}`;
}

const USAGE = `Usage: npm run dev:chrome [-- <options>]

  --seed            Seed the dev profile from the shared typed fixtures
                    (src/infra/chrome-storage/testing/storage-fixtures.mjs):
                    six chats, a provider, an MCP server, the settings.
                    Replaces the fixture-owned keyspace; other storage is left
                    alone. Same as \`npm run dev:seed\`.
  --port <n>        Preferred Vite dev-server port (default ${DEFAULT_PORT}); the first
                    free port at or above it is used.
  --profile <dir>   Chrome profile directory (default .chrome-dev-profile/).
  --no-demo         Don't start/open the demo fixture server.
  --help            Show this.
`;

function parseArgs(argv) {
  const options = {
    seed: false,
    port: DEFAULT_PORT,
    profileDir: DEFAULT_PROFILE_DIR,
    demo: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed") options.seed = true;
    else if (arg === "--no-demo") options.demo = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--profile") options.profileDir = path.resolve(ROOT, argv[++i] ?? "");
    else return { ...options, error: `unrecognised argument: ${arg}` };
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    return { ...options, error: `--port must be a port number, got: ${options.port}` };
  }
  return options;
}

/** True when nothing is listening on `port` — checked by binding it, which is the only answer that isn't a guess. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/** The first free port at or above `start`, so a second dev session (or anything else already on these ports) gets its own rather than a half-working extension pointing at someone else's server. */
async function findFreePort(start) {
  for (let port = start; port < start + 50; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in ${start}-${start + 49}`);
}

async function waitFor(predicate, { timeoutMs, label }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

/**
 * Starts Vite in dev mode with the repo's real vite.config.ts (CRXJS,
 * Svelte, Tailwind and the Paraglide codegen all included), overriding only
 * the output directory and the port. Nothing about the extension's own build
 * is re-declared here — an inline override is precisely so this script cannot
 * drift from the config the production build uses.
 */
async function startViteDevServer(port, outDir) {
  // Read by vite.config.ts's crx() options — see the header: CRXJS's own
  // `chrome.runtime.reload()` does not survive `--load-extension`, so this
  // script relaunches the browser for those edits instead.
  process.env.CRX_LIVE_RELOAD = "false";
  const server = await createServer({
    configFile: path.join(ROOT, "vite.config.ts"),
    root: ROOT,
    mode: "development",
    build: { outDir },
    server: {
      port,
      strictPort: true,
      // CRXJS writes the dev extension from inside the watched root; without
      // this the extension it just wrote looks like a source change and the
      // HMR client churns in a loop.
      watch: { ignored: ["**/dist-dev*/**", "**/dist/**", "**/dist-verify/**"] },
    },
    logLevel: "warn",
  });
  await server.listen();
  await waitFor(() => existsSync(path.join(ROOT, outDir, "manifest.json")), {
    timeoutMs: 30000,
    label: `CRXJS to write ${outDir}/manifest.json`,
  });
  return server;
}

/**
 * The edits Vite cannot hot-patch into a running extension, and that CRXJS's
 * own `chrome.runtime.reload()` cannot survive under `--load-extension` (see
 * the header) — so the browser is relaunched for them instead.
 *
 * `public/_locales/**` is here for the same reason as the manifest: Chrome
 * reads it once at install time (`__MSG_*` in manifest.config.ts), so nothing
 * short of a reload can show a change to it.
 */
function needsBrowserRelaunch(file) {
  const rel = path.relative(ROOT, file);
  return (
    rel.startsWith(`src${path.sep}background${path.sep}`) ||
    rel.startsWith(`src${path.sep}content${path.sep}`) ||
    rel.startsWith(`public${path.sep}_locales${path.sep}`) ||
    rel === "manifest.config.ts"
  );
}

/**
 * Drops the profile's cached service-worker scripts, so a relaunch actually
 * picks up a src/background/** edit.
 *
 * Measured, card 110, and deeply unobvious: in CRXJS dev mode the registered
 * worker script is `service-worker-loader.js`, a three-line file that
 * statically imports the real `src/background/sw.ts` FROM THE VITE DEV SERVER.
 * A module service worker's imports are stored with its REGISTRATION, and a
 * persistent profile keeps that registration across a relaunch — so the worker
 * went on running the module it had cached at install time. Verified twice
 * over: Vite served the edited module (fetched it from Node and read the new
 * bytes), while a listener added by that same edit never answered a message
 * from the panel. With this directory gone, the same probe answers in ~2s.
 *
 * Scoped to `Default/Service Worker`: extension storage lives in
 * `Local Extension Settings` / `Sync Extension Settings`, so the seeded world
 * and any settings set by hand survive untouched.
 */
function clearServiceWorkerCache(profileDir) {
  rmSync(path.join(profileDir, "Default", "Service Worker"), { recursive: true, force: true });
}

/**
 * Opens the browser on the session's two tabs: the side panel (as an ordinary
 * tab — MV3 side panels cannot be opened programmatically) and the demo
 * fixture page. Called on start AND on every relaunch, so a relaunched session
 * comes back looking exactly like a fresh one.
 */
async function openBrowser({ options, outPath, withDemo, seedStorage }) {
  clearServiceWorkerCache(options.profileDir);
  const ext = await launchExtension({ extensionPath: outPath, userDataDir: options.profileDir });
  // The window Chrome opens on launch, rather than a third tab next to it.
  const panel = ext.context.pages()[0] ?? (await ext.context.newPage());
  if (options.seed) {
    // The stubs go on BEFORE the first navigation (the panel reads
    // chrome.tabs during mount) — see verify/lib/seed.mjs for what they are
    // and why only this tab gets them.
    await installPanelFixtureStubs(panel);
    if (seedStorage) {
      console.log("Seeding the dev profile from the shared typed fixtures ...");
      await seedExtensionStorage(panel, ext.extensionId);
    }
  }
  await panel.goto(sidepanelUrl(ext.extensionId));
  if (withDemo) {
    const demoPage = await ext.context.newPage();
    await demoPage.goto(DEMO_INDEX_URL);
  }
  return { ext, panel };
}

/**
 * Brings up the whole session — Vite, the demo server, Chrome for Testing —
 * and returns live handles to it.
 *
 * Exported, and separate from {@link main}, so the session can be driven
 * programmatically: that is how the edit→see loop was PROVEN for card 110
 * (start a session, write a probe attribute into a component, watch it appear
 * in the running panel without a reload) rather than asserted from the
 * documentation of a plugin.
 *
 * @param {ReturnType<typeof parseArgs>} options
 */
export async function startDevSession(options) {
  const port = await findFreePort(options.port);
  const outDir = devOutDir(port);
  const outPath = path.join(ROOT, outDir);
  console.log(`Starting Vite (dev mode, CRXJS) on :${port}, writing ${outDir}/ ...`);
  const vite = await startViteDevServer(port, outDir);
  console.log("Vite ready.");

  let demoHandle = null;
  if (options.demo) {
    demoHandle = await startDemoServer().catch((err) => {
      console.warn(`Could not start the demo server (${err.message}) — carrying on without it.`);
      return null;
    });
    if (demoHandle) {
      console.log(
        demoHandle.alreadyRunning
          ? "Demo server already running on :5175 (reusing it; it will be left running)."
          : "Demo server started on :5175.",
      );
    }
  }

  mkdirSync(options.profileDir, { recursive: true });
  console.log(`Launching Chrome for Testing with ${outDir}/ loaded ...`);
  let current;
  try {
    current = await openBrowser({
      options,
      outPath,
      withDemo: demoHandle !== null,
      seedStorage: true,
    });
  } catch (err) {
    await vite.close();
    stopDemoServer(demoHandle);
    throw new Error(
      `could not launch Chrome for Testing with the profile at ${options.profileDir}: ${err instanceof Error ? err.message : String(err)}\n` +
        "If another dev:chrome session is already using that profile, close it or pass --profile <dir>.",
    );
  }

  let relaunching = false;
  /** Called when the browser goes away for a reason that was NOT a relaunch — i.e. the developer closed the window. */
  let onClosed = () => {};

  function watchForClose(context) {
    context.on("close", () => {
      if (!relaunching) onClosed();
    });
  }
  watchForClose(current.ext.context);

  async function relaunch(reason) {
    if (relaunching) return;
    relaunching = true;
    console.log(
      `\n${reason} — relaunching the browser (the profile, and everything in it, survives) ...`,
    );
    try {
      await current.ext.close();
      // The seed is already in the profile; re-writing it would throw away
      // whatever the session has done since.
      current = await openBrowser({
        options,
        outPath,
        withDemo: demoHandle !== null,
        seedStorage: false,
      });
      watchForClose(current.ext.context);
      console.log("Browser back up.");
    } catch (err) {
      console.error(`Relaunch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      relaunching = false;
    }
  }

  // Vite's own watcher, so the ignore list above (dist*, node_modules) is
  // honoured and this script adds no second file-watching dependency.
  let pending = null;
  vite.watcher.on("change", (file) => {
    if (!needsBrowserRelaunch(file)) return;
    // Debounced: a save can arrive as several events, and formatters make
    // that routine.
    clearTimeout(pending);
    pending = setTimeout(() => {
      void relaunch(`${path.relative(ROOT, file)} changed (not hot-patchable)`);
    }, 300);
  });

  return {
    port,
    outDir,
    outPath,
    vite,
    demoHandle,
    get ext() {
      return current.ext;
    },
    get context() {
      return current.ext.context;
    },
    get extensionId() {
      return current.ext.extensionId;
    },
    get buildId() {
      return current.ext.buildId;
    },
    get panel() {
      return current.panel;
    },
    /** Registers the callback fired when the developer closes the browser window (never on a relaunch). */
    onBrowserClosed(callback) {
      onClosed = callback;
    },
    async stop() {
      relaunching = true;
      await current.ext.close();
      await vite.close();
      stopDemoServer(demoHandle);
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (options.error) {
    console.error(`dev:chrome: ${options.error}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const session = await startDevSession(options);
  const { port, outPath, extensionId, buildId } = session;

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down (browser, Vite, demo server) ...");
    await session.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Closing the browser window is the natural way to end a dev session.
  session.onBrowserClosed(shutdown);

  console.log(
    `\n${"=".repeat(78)}\n` +
      `Chrome for Testing ${buildId} — extension id ${extensionId}\n` +
      `  profile:      ${options.profileDir} (persistent, gitignored)\n` +
      `  extension:    ${outPath} (dev mode — dist/ and dist-verify/ untouched)\n` +
      `  dev server:   http://localhost:${port}\n` +
      `  side panel:   ${sidepanelUrl(extensionId)}\n` +
      `  options page: ${optionsUrl(extensionId)}\n` +
      `${options.seed ? "  seeded:       yes (six chats, a provider, an MCP server)\n" : ""}` +
      `${"=".repeat(78)}\n` +
      "\nEDIT → SEE: save any UI file and the open panel/options tab updates in place (Svelte\n" +
      "HMR, well under a second, no reload, no lost state). Saving under src/background/**,\n" +
      "src/content/**, public/_locales/** or manifest.config.ts cannot be hot-patched, so this\n" +
      "script relaunches the browser for you (~3s; the profile and everything in it survives).\n" +
      "\nThe tab opened on the side panel is the panel's page opened as an ORDINARY TAB — MV3\n" +
      "side panels cannot be opened programmatically. It is the fastest surface to iterate on;\n" +
      "for the real thing (docked, against the real active tab) click the extension's toolbar\n" +
      "icon, pinning it from the puzzle-piece menu first if it isn't visible.\n" +
      `${options.seed ? "\nThat panel tab is also stubbed to look at the fixture's example.com tab, so the seeded\nchat and its page tools are visible on it. The DOCKED panel is never stubbed: it sees the\nreal active tab, plus the same seeded storage.\n" : "\nRun with --seed (or `npm run dev:seed`) to open onto realistic chats/providers instead of\nempty state.\n"}` +
      "\nCtrl-C stops the browser, Vite and the demo server together.",
  );
}

// Only when RUN, never when imported — {@link startDevSession} is imported by
// tooling that drives a session itself, and a module-load side effect would
// start a second browser behind it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("\ndev:chrome failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
