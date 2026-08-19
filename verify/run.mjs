#!/usr/bin/env node
// npm run verify — in-browser verification harness.
// boards/project-backlog/25-in-browser-verification-harness.md
//
// Builds the extension into its own output dir (dist-verify/, never dist/,
// so a concurrent `npm run build` elsewhere cannot corrupt this run),
// launches real Chromium with it loaded unpacked via a persistent context,
// and exercises the claims listed on the card against the demo fixtures.
// Every check is a real, observable browser behaviour — not a re-read of
// build output.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL, DEMO_LATE_URL } from "./lib/demoServer.mjs";
import { launchExtension, sidepanelUrl } from "./lib/browser.mjs";
import { findTabId, getTools, callTool } from "./lib/runtime.mjs";
import { attachServiceWorkerCdp, stopWorker } from "./lib/serviceWorker.mjs";
import { createReport } from "./lib/report.mjs";
import { assert, assertSetEqual, pollUntil } from "./lib/assert.mjs";
import { screenshotSidepanel } from "./checks/screenshots.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCREENSHOT_DIR = path.join(ROOT, "verify", "output", "screenshots");

const EXPECTED_FIXED_TOOLS = [
  "read-page-state",
  "add-note",
  "clear-notes",
  "create-task",
  "always-throws",
  "hangs-forever",
];

async function main() {
  const report = createReport();
  let demoHandle = null;
  let ext = null;

  console.log("Building extension -> dist-verify/ ...");
  await buildExtension();
  console.log("Build OK.");

  console.log("Starting demo server (or reusing one already running) on :5175 ...");
  demoHandle = await startDemoServer();
  console.log(demoHandle.alreadyRunning ? "Demo server already running." : "Demo server started.");

  try {
    console.log("Launching Chromium with dist-verify/ loaded unpacked ...");
    ext = await launchExtension();
    console.log(`Extension id resolved at runtime: ${ext.extensionId}`);

    const { context, extensionId } = ext;

    // Control tab: an extension-origin page used to drive chrome.* APIs
    // directly, independent of whatever the (concurrently edited) Svelte
    // side panel UI currently renders. Per the card, MV3 side panel UI
    // cannot be opened programmatically, so we open its page as a plain tab.
    const controlPage = await context.newPage();
    await controlPage.goto(sidepanelUrl(extensionId));

    // ---------------------------------------------------------------------
    // 1. MAIN-world execution + ISOLATED-world isolation
    // ---------------------------------------------------------------------
    const demoPage = await context.newPage();
    const demoConsoleErrors = [];
    demoPage.on("console", (msg) => {
      if (msg.type() === "error") demoConsoleErrors.push(msg.text());
    });

    await report.run("MAIN-world bridge executes in the page world, ISOLATED relay cannot see its globals", async () => {
      await demoPage.goto(DEMO_INDEX_URL);
      await demoPage.waitForFunction(
        () => document.getElementById("status")?.dataset.kind === "ok",
        { timeout: 10000 },
      );
      const stamp = await demoPage.evaluate(() => window.__webmcpBridgeInstalled);
      assert(
        stamp && stamp.source === "main-world-bridge" && typeof stamp.at === "number",
        `window.__webmcpBridgeInstalled was not set in the page's MAIN world (got ${JSON.stringify(stamp)})`,
      );
      const leak = demoConsoleErrors.find((t) => t.includes("WORLD ISOLATION BROKEN"));
      assert(
        !leak,
        `the ISOLATED-world relay logged a world-isolation breach: ${leak}`,
      );
      return { mainWorldStamp: stamp, isolationErrorsSeen: demoConsoleErrors.filter((t) => t.includes("ISOLATION")).length };
    });

    // ---------------------------------------------------------------------
    // 2a. Tool discovery against demo/index.html
    // ---------------------------------------------------------------------
    let tabId = null;
    await report.run("Tool discovery works against demo/index.html (shim-provided)", async () => {
      tabId = await findTabId(controlPage, DEMO_INDEX_URL);
      assert(tabId !== null, `could not find an open tab for ${DEMO_INDEX_URL}`);
      const tools = await pollUntil(
        () => getTools(controlPage, tabId),
        (t) => t.length === EXPECTED_FIXED_TOOLS.length,
        { timeoutMs: 5000, label: "worker registry to report all 6 fixed demo tools" },
      );
      assertSetEqual(tools.map((t) => t.name), EXPECTED_FIXED_TOOLS, "tool set from demo/index.html");
      assert(
        tools.every((t) => t.source === "shim"),
        `expected all tools to report source "shim" on the plain shim page, got: ${tools.map((t) => `${t.name}=${t.source}`).join(", ")}`,
      );
      return { tabId, tools: tools.map((t) => t.name) };
    });

    // ---------------------------------------------------------------------
    // 2b + 3. Navigate to late.html: registry must clear, then late-adopt
    //         the fake polyfill assigned ~2s after load.
    // ---------------------------------------------------------------------
    await report.run("Registry clears on navigation (before late.html's polyfill has loaded)", async () => {
      assert(tabId !== null, "no tabId from the previous check");
      await demoPage.goto(DEMO_LATE_URL);
      // late.html deliberately waits 2s before auto-loading its fake
      // polyfill (demo/src/late-main.ts) — query well inside that window so
      // an empty result is unambiguous evidence of a clear, not a race.
      const tools = await getTools(controlPage, tabId);
      assert(
        tools.length === 0,
        `expected the tab's registry to be empty right after navigating to late.html (before its 2s-delayed polyfill loads), got: ${tools.map((t) => t.name).join(", ")}`,
      );
      return { toolsImmediatelyAfterNav: tools.length };
    });

    await report.run(
      "Tool discovery works against demo/late.html (late navigator.modelContext assignment)",
      async () => {
        // Trigger deterministically rather than racing the page's own 2s
        // auto-timer; loadPolyfillAndRegisterTools() guards against a
        // double-fire either way.
        const loadBtn = demoPage.locator("#load-polyfill");
        if (await loadBtn.isEnabled().catch(() => false)) {
          await loadBtn.click().catch(() => {});
        }
        await demoPage.waitForFunction(
          () => document.getElementById("status")?.dataset.kind === "ok",
          { timeout: 8000 },
        );
        const tools = await pollUntil(
          () => getTools(controlPage, tabId),
          (t) => t.length === EXPECTED_FIXED_TOOLS.length,
          { timeoutMs: 5000, label: "worker registry to report all 6 tools after late adoption" },
        );
        assertSetEqual(tools.map((t) => t.name), EXPECTED_FIXED_TOOLS, "tool set from demo/late.html");
        assert(
          tools.every((t) => t.source === "polyfill"),
          `expected all tools to report source "polyfill" once the accessor setter adopted the fake polyfill, got: ${tools.map((t) => `${t.name}=${t.source}`).join(", ")}`,
        );
        return { tools: tools.map((t) => t.name) };
      },
    );

    // ---------------------------------------------------------------------
    // 6. Dynamic register/unregister propagates as a live tool-list update
    // ---------------------------------------------------------------------
    await report.run("Dynamic register/unregister propagates as a live tool-list update", async () => {
      await demoPage.locator("#register-dynamic").click();
      const afterRegister = await pollUntil(
        () => getTools(controlPage, tabId),
        (t) => t.some((x) => x.name === "dynamic-echo"),
        { timeoutMs: 3000, label: '"dynamic-echo" to appear in the registry after registerTool()' },
      );
      assert(
        afterRegister.some((t) => t.name === "dynamic-echo"),
        "dynamic-echo tool did not appear after clicking #register-dynamic",
      );

      await demoPage.locator("#unregister-dynamic").click();
      const afterUnregister = await pollUntil(
        () => getTools(controlPage, tabId),
        (t) => !t.some((x) => x.name === "dynamic-echo"),
        { timeoutMs: 3000, label: '"dynamic-echo" to disappear from the registry after unregisterTool()' },
      );
      assert(
        !afterUnregister.some((t) => t.name === "dynamic-echo"),
        "dynamic-echo tool was still present after clicking #unregister-dynamic",
      );
      return { registered: true, unregistered: true };
    });

    // ---------------------------------------------------------------------
    // 5. Tool call end to end, including throwing and hanging tools
    // ---------------------------------------------------------------------
    await report.run("Tool call end-to-end: read-page-state succeeds with a real result", async () => {
      const res = await callTool(controlPage, tabId, "read-page-state", {});
      assert(res.ok === true, `expected ok:true, got ${JSON.stringify(res)}`);
      assert(
        res.result && typeof res.result.title === "string" && typeof res.result.url === "string",
        `unexpected result shape: ${JSON.stringify(res.result)}`,
      );
      return res.result;
    });

    await report.run("Tool call end-to-end: always-throws returns a clean error, not a hang or crash", async () => {
      const res = await callTool(controlPage, tabId, "always-throws", {});
      assert(res.ok === false, `expected ok:false, got ${JSON.stringify(res)}`);
      assert(
        typeof res.error === "string" && res.error.includes("Deliberate failure"),
        `unexpected error message: ${res.error}`,
      );
      return { error: res.error };
    });

    await report.run(
      "Tool call end-to-end: hangs-forever hits the bridge's 20s timeout and returns a clean error",
      async () => {
        const startedAt = Date.now();
        const res = await callTool(controlPage, tabId, "hangs-forever", {});
        const elapsedMs = Date.now() - startedAt;
        assert(res.ok === false, `expected ok:false, got ${JSON.stringify(res)}`);
        assert(
          typeof res.error === "string" && res.error.includes("Timed out after 20000ms"),
          `expected the bridge's own 20s EXECUTE_TIMEOUT_MS error, got: ${res.error}`,
        );
        assert(
          elapsedMs >= 19000 && elapsedMs < 25000,
          `expected the timeout to fire close to 20s (bridge timeout, not the relay's 25s backstop), took ${elapsedMs}ms`,
        );
        return { error: res.error, elapsedMs };
      },
    );

    // ---------------------------------------------------------------------
    // 4. Registry recovery after the MV3 worker is killed
    // ---------------------------------------------------------------------
    await report.run(
      "Registry recovers after the MV3 service worker is killed (runtime:refresh-tools path)",
      async () => {
        const baseline = await getTools(controlPage, tabId);
        assert(baseline.length > 0, "expected a non-empty baseline tool list before killing the worker");

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
          // runtime:refresh-tools round trip to the content relay.
          const recovered = await getTools(controlPage, tabId);

          const restarted = await cdp.waitForStatus(running.versionId, "running", 8000);
          assert(restarted, "CDP never confirmed the service worker came back to runningStatus 'running'");
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
    );

    // ---------------------------------------------------------------------
    // 7. Screenshots — BEST EFFORT (panel is being actively edited elsewhere)
    // ---------------------------------------------------------------------
    await report.runBestEffort(
      "Side panel screenshot at 320px width, light and dark (human eyeball check)",
      async () => {
        const { lightPath, darkPath } = await screenshotSidepanel(context, extensionId, SCREENSHOT_DIR);
        return { lightPath, darkPath };
      },
    );

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
    stopDemoServer(demoHandle);
  }
}

main().catch((err) => {
  console.error("\nverify harness crashed before completing:", err);
  process.exitCode = 1;
});
