#!/usr/bin/env node
// npm run verify — in-browser verification harness.
// boards/project-backlog/25-in-browser-verification-harness.md
// boards/project-backlog/46-verify-harness-on-chrome-for-testing.md
//
// Builds the extension into its own output dir (dist-verify/, never dist/,
// so a concurrent `npm run build` elsewhere cannot corrupt this run),
// launches Chrome for Testing with it loaded unpacked via a persistent
// context (verify/lib/browser.mjs — decisions/16-native-webmcp-client.md),
// and exercises the real native-WebMCP client against the demo fixtures.
// Every check is a real, observable browser behaviour — not a re-read of
// build output.
//
// This suite used to test a MAIN-world "adopt-or-provide" bridge
// (src/inject/bridge.ts) that decisions/16 deleted: world-isolation
// assertions, a `source: "shim"|"polyfill"|"native"` field, and a
// late.html/polyfill-adoption fixture. All three are gone along with the
// architecture they tested — the assertions below exercise the real thing
// that replaced it: native `document.modelContext`, read via
// `getTools()`/`ontoolchange`/`executeTool()` directly from the ISOLATED
// world (src/content/relay.ts).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELAY_EXECUTE_TIMEOUT_MS } from "../src/infra/webmcp/timeouts.mjs";
import { buildExtension } from "./lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "./lib/demoServer.mjs";
import { launchExtension, sidepanelUrl } from "./lib/browser.mjs";
import { findTabId, getTools, getToolsResponse, callTool } from "./lib/runtime.mjs";
import { attachServiceWorkerCdp, stopWorker } from "./lib/serviceWorker.mjs";
import { createReport } from "./lib/report.mjs";
import { assert, assertSetEqual, pollUntil } from "./lib/assert.mjs";
import { screenshotSurfaces } from "./checks/screenshots.mjs";
import { checkPageContext } from "./checks/pageContext.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCREENSHOT_DIR = path.join(ROOT, "verify", "output", "screenshots");

// ---------------------------------------------------------------------------
// Running ONE check: `npm run verify -- --check <name>` (card 110)
//
// Every `report.run` below carries a short name, listed here so `--check`
// can be validated against something and `--list` can print it. A name that
// isn't in this list is a typo, and a typo must fail loudly rather than
// quietly verify nothing.
//
// What `--check` does NOT skip: the build, the demo server, the browser
// launch, and the navigation/setup between checks. Those are shared state the
// later checks depend on (the demo tab, its tab id, the control page), so a
// single check still costs a browser — it just stops after the one assertion
// you asked about instead of running all eleven. It is for iterating on a
// check, not for a faster gate; the gate is the whole suite.
// ---------------------------------------------------------------------------
const CHECK_NAMES = [
  "tool-discovery",
  "registry-clears-on-nav",
  "dynamic-tools",
  "tool-call-read",
  "tool-call-mutate",
  "tool-call-error",
  "tool-call-timeout",
  "page-context",
  "worker-restart",
  "screenshots",
  "webmcp-unavailable",
];

function parseSelection(argv) {
  const requested = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list") return { list: true };
    if (argv[i] === "--check") requested.push(...(argv[++i] ?? "").split(","));
    else if (argv[i].startsWith("--check=")) requested.push(...argv[i].slice(8).split(","));
    else return { error: `unrecognised argument: ${argv[i]}` };
  }
  if (requested.length === 0) return { selected: null };
  const unknown = requested.filter((name) => !CHECK_NAMES.includes(name));
  if (unknown.length > 0) return { error: `unknown check(s): ${unknown.join(", ")}` };
  return { selected: new Set(requested) };
}

const USAGE =
  "Usage: npm run verify [-- --check <name>[,<name>] | --list]\n\nChecks:\n" +
  CHECK_NAMES.map((n) => `  ${n}`).join("\n");

// The 7 fixed fixtures demo/src/tools.ts registers on load. "dynamic-echo"
// is deliberately excluded — it's registered/unregistered at runtime via the
// page's #register-dynamic/#unregister-dynamic buttons, exercised in its own
// check below.
const EXPECTED_FIXED_TOOLS = [
  "read-page-state",
  "read-notes-content",
  "add-note",
  "clear-notes",
  "create-task",
  "always-throws",
  "hangs-forever",
];

/**
 * Unwraps the MCP-shaped `CallToolResult` a demo fixture's `execute()`
 * returns (`demo/src/tools.ts`'s `ok()` helper: `{ content: [{ type: "text",
 * text: JSON.stringify(data) }] }`) — this is what actually crosses the wire
 * from `document.modelContext.executeTool()` through src/content/relay.ts,
 * not a bare value. Returns the parsed `data`.
 */
function parseMcpContent(result) {
  assert(
    result && Array.isArray(result.content),
    `expected an MCP-shaped CallToolResult ({content: [...]}), got: ${JSON.stringify(result)}`,
  );
  const textPart = result.content.find((c) => c.type === "text" && typeof c.text === "string");
  assert(textPart, `expected a {type:"text"} content part, got: ${JSON.stringify(result.content)}`);
  try {
    return JSON.parse(textPart.text);
  } catch {
    return textPart.text;
  }
}

async function main() {
  const selection = parseSelection(process.argv.slice(2));
  if (selection.list) {
    console.log(USAGE);
    return;
  }
  if (selection.error) {
    console.error(`verify: ${selection.error}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const report = createReport({ selected: selection.selected });
  if (selection.selected) {
    console.log(
      `Running only: ${[...selection.selected].join(", ")} — the build, demo server, browser and ` +
        "the setup between checks still run; the other checks report SKIP.",
    );
  }
  let demoHandle = null;
  let ext = null;
  let unavailableExt = null;

  console.log("Building extension -> dist-verify/ ...");
  await buildExtension();
  console.log("Build OK.");

  console.log("Starting demo server (or reusing one already running) on :5175 ...");
  demoHandle = await startDemoServer();
  console.log(demoHandle.alreadyRunning ? "Demo server already running." : "Demo server started.");

  try {
    console.log(
      "Resolving Chrome for Testing and launching it with dist-verify/ loaded unpacked, WebMCP enabled ...",
    );
    ext = await launchExtension({ enableWebMcp: true });
    console.log(
      `Chrome for Testing ${ext.buildId}; extension id resolved at runtime: ${ext.extensionId}`,
    );

    const { context, extensionId } = ext;

    // Control tab: an extension-origin page used to drive chrome.* APIs
    // directly, independent of whatever the (concurrently edited) Svelte
    // side panel UI currently renders. Per the card, MV3 side panel UI
    // cannot be opened programmatically, so we open its page as a plain tab.
    const controlPage = await context.newPage();
    await controlPage.goto(sidepanelUrl(extensionId));

    const demoPage = await context.newPage();

    // SETUP, not a check. The discovery check below is what normally opens
    // the demo tab and captures its id, and every later check needs both —
    // but `--check <name>` (card 110) can filter that check out. Doing it
    // here as well costs one navigation and makes any single check runnable
    // on its own; the check still does it for itself, because "a tab id can
    // be found for this page" is part of what it asserts.
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 10000,
    });
    let tabId = await findTabId(controlPage, DEMO_INDEX_URL);

    // ---------------------------------------------------------------------
    // Tool discovery via getTools(), against the real document.modelContext
    // ---------------------------------------------------------------------
    await report.run(
      "Tool discovery works against demo/index.html via native getTools()",
      async () => {
        await demoPage.goto(DEMO_INDEX_URL);
        await demoPage.waitForFunction(
          () => document.getElementById("status")?.dataset.kind === "ok",
          { timeout: 10000 },
        );
        tabId = await findTabId(controlPage, DEMO_INDEX_URL);
        assert(tabId !== null, `could not find an open tab for ${DEMO_INDEX_URL}`);
        const res = await pollUntil(
          () => getToolsResponse(controlPage, tabId),
          (r) => r.tools.length === EXPECTED_FIXED_TOOLS.length,
          { timeoutMs: 5000, label: "worker registry to report all 7 fixed demo tools" },
        );
        assert(
          res.available === true,
          `expected available:true on a page with document.modelContext, got ${res.available}`,
        );
        assertSetEqual(
          res.tools.map((t) => t.name),
          EXPECTED_FIXED_TOOLS,
          "tool set from demo/index.html",
        );

        const readNotes = res.tools.find((t) => t.name === "read-notes-content");
        assert(readNotes, "read-notes-content tool missing from discovery");
        assert(
          readNotes.annotations?.readOnlyHint === true &&
            readNotes.annotations?.untrustedContentHint === true,
          `expected read-notes-content annotations {readOnlyHint:true, untrustedContentHint:true}, got ${JSON.stringify(readNotes.annotations)}`,
        );
        return { tabId, tools: res.tools.map((t) => t.name) };
      },
      "tool-discovery",
    );

    // ---------------------------------------------------------------------
    // Registry clears on navigation (kept from the pre-46 suite — still the
    // right behaviour under the native client, since sw.ts clears its
    // per-tab registry entry on any URL change regardless of what API
    // produced the tools).
    // ---------------------------------------------------------------------
    await report.run(
      "Registry clears on navigation",
      async () => {
        assert(tabId !== null, "no tabId from the previous check");
        await demoPage.goto("about:blank");
        const res = await pollUntil(
          () => getToolsResponse(controlPage, tabId),
          (r) => r.tools.length === 0,
          {
            timeoutMs: 5000,
            label: "worker registry to clear after navigating away from demo/index.html",
          },
        );
        assert(
          res.tools.length === 0,
          `expected an empty tool list after navigation, got: ${res.tools.map((t) => t.name).join(", ")}`,
        );
        return { toolsAfterNav: res.tools.length };
      },
      "registry-clears-on-nav",
    );

    // Navigate back so the remaining demo-page checks have a live tab again.
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 10000,
    });
    tabId = await pollUntil(
      () => findTabId(controlPage, DEMO_INDEX_URL),
      (id) => id !== null,
      { timeoutMs: 5000, label: "tab id for demo/index.html to reappear after navigating back" },
    );
    await pollUntil(
      () => getTools(controlPage, tabId),
      (t) => t.length === EXPECTED_FIXED_TOOLS.length,
      {
        timeoutMs: 5000,
        label: "worker registry to re-report all 7 tools after navigating back to demo/index.html",
      },
    );

    // ---------------------------------------------------------------------
    // Live add/remove propagates through document.modelContext.ontoolchange
    // (dynamic-echo, driven by the page's own #register-dynamic /
    // #unregister-dynamic buttons and a real AbortController —
    // demo/src/main.ts).
    // ---------------------------------------------------------------------
    await report.run(
      "Dynamic register/unregister propagates through ontoolchange",
      async () => {
        await demoPage.locator("#register-dynamic").click();
        const afterRegister = await pollUntil(
          () => getTools(controlPage, tabId),
          (t) => t.some((x) => x.name === "dynamic-echo"),
          {
            timeoutMs: 3000,
            label: '"dynamic-echo" to appear in the registry after registerTool()',
          },
        );
        assert(
          afterRegister.some((t) => t.name === "dynamic-echo"),
          "dynamic-echo tool did not appear after clicking #register-dynamic",
        );

        await demoPage.locator("#unregister-dynamic").click();
        const afterUnregister = await pollUntil(
          () => getTools(controlPage, tabId),
          (t) => !t.some((x) => x.name === "dynamic-echo"),
          {
            timeoutMs: 3000,
            label: '"dynamic-echo" to disappear from the registry after AbortController.abort()',
          },
        );
        assert(
          !afterUnregister.some((t) => t.name === "dynamic-echo"),
          "dynamic-echo tool was still present after clicking #unregister-dynamic",
        );
        return { registered: true, unregistered: true };
      },
      "dynamic-tools",
    );

    // ---------------------------------------------------------------------
    // Tool call end to end: success, error, and timeout paths, all through
    // the real executeTool() round trip (src/content/relay.ts).
    // ---------------------------------------------------------------------
    await report.run(
      "Tool call end-to-end: read-page-state round-trips through executeTool with parsed MCP content",
      async () => {
        const res = await callTool(controlPage, tabId, "read-page-state", {});
        assert(res.ok === true, `expected ok:true, got ${JSON.stringify(res)}`);
        const data = parseMcpContent(res.result);
        assert(
          typeof data.title === "string" && typeof data.url === "string",
          `unexpected parsed content shape: ${JSON.stringify(data)}`,
        );
        return data;
      },
      "tool-call-read",
    );

    await report.run(
      "Tool call end-to-end: add-note mutates the page and create-task accepts a rich schema",
      async () => {
        const addRes = await callTool(controlPage, tabId, "add-note", {
          text: "verify harness note",
        });
        assert(addRes.ok === true, `expected ok:true from add-note, got ${JSON.stringify(addRes)}`);
        const addData = parseMcpContent(addRes.result);
        assert(
          addData.added === "verify harness note",
          `unexpected add-note result: ${JSON.stringify(addData)}`,
        );

        const taskRes = await callTool(controlPage, tabId, "create-task", {
          title: "Ship it",
          priority: "high",
          assignee: { name: "Jonathan" },
        });
        assert(
          taskRes.ok === true,
          `expected ok:true from create-task, got ${JSON.stringify(taskRes)}`,
        );
        const taskData = parseMcpContent(taskRes.result);
        assert(
          taskData.priority === "high",
          `unexpected create-task result: ${JSON.stringify(taskData)}`,
        );
        return { addData, taskData };
      },
      "tool-call-mutate",
    );

    await report.run(
      "Tool call end-to-end: always-throws surfaces a clean error, not a hang or crash",
      async () => {
        const res = await callTool(controlPage, tabId, "always-throws", {});
        assert(res.ok === false, `expected ok:false, got ${JSON.stringify(res)}`);
        // Chrome's native executeTool() does not propagate the thrown Error's
        // own message text across the WebIDL boundary — it reports its own
        // generic wording instead. Measured directly against Chrome for
        // Testing 152.0.7977.54 while building this harness (card 46); the
        // check is that a throwing tool cleanly surfaces AS an error (ok:false,
        // some message), not that the original "Deliberate failure..." text
        // survives.
        assert(
          typeof res.error === "string" && res.error.length > 0,
          `expected a non-empty error message for a throwing tool, got: ${res.error}`,
        );
        return { error: res.error };
      },
      "tool-call-error",
    );

    await report.run(
      "Tool call end-to-end: hangs-forever hits the relay's own executeTool timeout and returns a clean error",
      async () => {
        const startedAt = Date.now();
        const res = await callTool(controlPage, tabId, "hangs-forever", {});
        const elapsedMs = Date.now() - startedAt;
        assert(res.ok === false, `expected ok:false, got ${JSON.stringify(res)}`);
        assert(
          typeof res.error === "string" &&
            res.error.includes(`Timed out after ${RELAY_EXECUTE_TIMEOUT_MS}ms`),
          `expected the relay's own EXECUTE_TIMEOUT_MS=${RELAY_EXECUTE_TIMEOUT_MS} error (src/content/relay.ts), got: ${res.error}`,
        );
        assert(
          elapsedMs >= RELAY_EXECUTE_TIMEOUT_MS - 1000 &&
            elapsedMs < RELAY_EXECUTE_TIMEOUT_MS + 5000,
          `expected the timeout to fire close to the relay's ${RELAY_EXECUTE_TIMEOUT_MS}ms (not the worker's 30s CALL_TIMEOUT_MS backstop in src/background/sw.ts), took ${elapsedMs}ms`,
        );
        return { error: res.error, elapsedMs };
      },
      "tool-call-timeout",
    );

    // ---------------------------------------------------------------------
    // Page context (card 118). The check itself lives in
    // ./checks/pageContext.mjs — it needs a REAL selection made with a real
    // Range and a real chrome:// tab, which is a page's worth of setup — and
    // is registered here so it shares this run's control page, demo tab and
    // tab id rather than launching a second browser. It stays runnable on its
    // own as `node verify/checks/pageContext.mjs`.
    // ---------------------------------------------------------------------
    await report.run(
      "Page context: a real selection and a real page extract round-trip panel -> worker -> relay, and a restricted tab says so",
      () => checkPageContext({ controlPage, demoPage, tabId }),
      "page-context",
    );

    // ---------------------------------------------------------------------
    // Registry recovery after the MV3 worker is killed
    // ---------------------------------------------------------------------
    await report.run(
      "Registry recovers after the MV3 service worker is killed (runtime:refresh-tools path)",
      async () => {
        const baseline = await getTools(controlPage, tabId);
        assert(
          baseline.length > 0,
          "expected a non-empty baseline tool list before killing the worker",
        );

        const cdp = await attachServiceWorkerCdp(context);
        try {
          const running = await cdp.waitForRunningVersion(extensionId, 8000);
          assert(running, "never observed a running service worker version via CDP");

          await stopWorker(cdp, running.versionId);
          const stopped = await cdp.waitForStatus(running.versionId, "stopped", 8000);
          assert(stopped, "CDP never confirmed the service worker reached runningStatus 'stopped'");

          // The in-memory registry Map in src/background/sw.ts is gone now
          // (MV3 workers fully re-execute their top-level module on the next
          // wake — no persisted heap across a stop). Asking for this tab's
          // tools forces a cache miss -> pullToolsFromRelay ->
          // runtime:refresh-tools round trip to the content relay, which now
          // reads document.modelContext.getTools() directly (no MAIN-world
          // bridge to wait out any more).
          const recovered = await getTools(controlPage, tabId);

          const restarted = await cdp.waitForStatus(running.versionId, "running", 8000);
          assert(
            restarted,
            "CDP never confirmed the service worker came back to runningStatus 'running'",
          );
          assert(
            restarted.versionId === running.versionId,
            "expected the same service worker versionId to restart (a different id would mean this wasn't a restart)",
          );

          assertSetEqual(
            recovered.map((t) => t.name),
            baseline.map((t) => t.name),
            "tool set recovered after worker restart vs. pre-kill baseline",
          );
          return {
            baselineCount: baseline.length,
            recoveredCount: recovered.length,
            versionId: running.versionId,
          };
        } finally {
          await cdp.close();
        }
      },
      "worker-restart",
    );

    // The control page is a REAL side panel, mounted on whatever tab is
    // actually active, and it has been open since the top of this run —
    // which means it has been creating and persisting chats of its own the
    // whole time (one for its own `chrome-extension://` tab, one for the
    // demo tab's trip through `about:blank`). Every check that needs it is
    // done by here, and leaving it open makes those strays show up in the
    // options page's chat-history screenshot below, where a reviewer has no
    // way to tell a harness artefact from a real bug. The remaining check
    // uses its own control page in a second browser.
    await controlPage.close();

    // ---------------------------------------------------------------------
    // Screenshots — BEST EFFORT, but not silently so: checks/screenshots.mjs
    // asserts its full expected matrix, so a drifted selector reports SKIP
    // naming the missing shot rather than PASS with a shorter file list.
    // ---------------------------------------------------------------------
    await report.runBestEffort(
      "UI screenshots: side panel at 320/400px x light/dark plus its overflow menu, model sheet and activity timeline, and the options page in light/dark (human eyeball check)",
      async () => {
        const { count, files } = await screenshotSurfaces(context, extensionId, SCREENSHOT_DIR);
        return { count, files };
      },
      "screenshots",
    );

    // ---------------------------------------------------------------------
    // The ABSENT case: a second, separate browser launched WITHOUT
    // --enable-features=WebMCP. document.modelContext is genuinely undefined
    // there, and src/content/relay.ts must report that as the distinct
    // available:false state (card 43 / decisions/16), never an empty tool
    // list indistinguishable from "this page just has zero tools".
    // ---------------------------------------------------------------------
    await report.run(
      "WebMCP-unavailable: without --enable-features=WebMCP the extension reports available:false, not an empty tool list",
      async () => {
        unavailableExt = await launchExtension({ enableWebMcp: false });
        const unavailControlPage = await unavailableExt.context.newPage();
        await unavailControlPage.goto(sidepanelUrl(unavailableExt.extensionId));

        const unavailDemoPage = await unavailableExt.context.newPage();
        await unavailDemoPage.goto(DEMO_INDEX_URL);
        // main.ts checks `document.modelContext` once, synchronously, and
        // sets #status to "error" immediately when it's missing — no
        // polling needed, but wait for that terminal state defensively.
        await unavailDemoPage.waitForFunction(
          () => document.getElementById("status")?.dataset.kind === "error",
          { timeout: 10000 },
        );
        const modelContextIsUndefined = await unavailDemoPage.evaluate(
          () => document.modelContext === undefined,
        );
        assert(
          modelContextIsUndefined,
          "expected document.modelContext to be undefined without --enable-features=WebMCP",
        );

        const unavailTabId = await pollUntil(
          () => findTabId(unavailControlPage, DEMO_INDEX_URL),
          (id) => id !== null,
          { timeoutMs: 5000, label: "tab id for demo/index.html in the no-WebMCP browser" },
        );
        const res = await pollUntil(
          () => getToolsResponse(unavailControlPage, unavailTabId),
          (r) => r.available === false,
          { timeoutMs: 5000, label: "runtime:get-tools-response to report available:false" },
        );
        assert(res.available === false, `expected available:false, got ${JSON.stringify(res)}`);
        assert(
          res.tools.length === 0,
          `expected an empty tool list alongside available:false, got: ${res.tools.map((t) => t.name).join(", ")}`,
        );
        return { available: res.available, toolCount: res.tools.length };
      },
      "webmcp-unavailable",
    );

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (unavailableExt) await unavailableExt.close();
    if (ext) await ext.close();
    stopDemoServer(demoHandle);
  }
}

main().catch((err) => {
  console.error("\nverify harness crashed before completing:", err);
  process.exitCode = 1;
});
