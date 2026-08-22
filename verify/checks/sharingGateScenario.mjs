#!/usr/bin/env node
// Scenario pack (card 112, boards/project-backlog/112-verify-scenario-pack.md):
// the sharing gate + selection chip, end to end through the REAL side panel
// UI (card 119, decisions/40-page-context-access.md). No model needed — this
// never sends a chat turn, it only drives the gate itself and reads what it
// actually did to the DOM (the ContextChip's own `data-sharing` attribute,
// the SelectionChip, the Inspector's tools list) rather than asserting on
// pixels.
//
// Sequence: a real `window.getSelection()` Range is put on the demo page
// (the same technique verify/checks/pageContext.mjs uses to prove a real
// selection round-trips through the relay) -> a "focus" event fires on the
// panel's own window, the pull card 119 wires up
// (src/sidepanel/stores/pageSharing.svelte.ts's `initPageSharingSync`) ->
// the SelectionChip appears -> "Stop sharing this page" dismisses the gate,
// which must hide BOTH the selection chip AND the page's tools from the
// Inspector, with no residual tool count anywhere -> "Share this page"
// re-enables it, and the selection chip (the underlying browser selection
// was never cleared, only its EXTENSION-side snapshot was) comes back too.
//
// NOT wired into `npm run verify` / `npm run guard` / CI, same posture as the
// existing smokes. Run manually:
//
//   node verify/checks/sharingGateScenario.mjs

import { buildExtension } from "../lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "../lib/demoServer.mjs";
import { launchExtension, sidepanelUrl } from "../lib/browser.mjs";
import { createReport } from "../lib/report.mjs";
import { assert, assertEqual } from "../lib/assert.mjs";

/** The demo page element this scenario selects — same stable target verify/checks/pageContext.mjs uses. */
const SELECTION_TARGET = "main .panel .hint";

const DEMO_PAGE_TOOL_NAMES = [
  "read-page-state",
  "read-notes-content",
  "add-note",
  "clear-notes",
  "create-task",
  "always-throws",
  "hangs-forever",
];

async function selectOnPage(demoPage, cssSelector) {
  return demoPage.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return null;
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.addRange(range);
    return selection.toString().replace(/\s+/g, " ").trim();
  }, cssSelector);
}

async function sharingAttr(panel) {
  return panel.locator("div[data-sharing]").first().getAttribute("data-sharing");
}

async function openInspector(panel) {
  await panel.getByRole("button", { name: "More options" }).click();
  await panel.getByRole("menuitem", { name: "Tools & call log" }).click();
}

async function backToChat(panel) {
  await panel.getByRole("button", { name: "Back to chat" }).click();
}

async function main() {
  const report = createReport();

  console.log("Building extension -> dist-verify/ ...");
  await buildExtension();
  console.log("Build OK.");

  console.log("Starting demo server (or reusing one already running) on :5175 ...");
  const demoHandle = await startDemoServer();
  console.log(demoHandle.alreadyRunning ? "Demo server already running." : "Demo server started.");

  let ext = null;
  try {
    console.log("Launching Chrome for Testing with the built extension, WebMCP enabled ...");
    ext = await launchExtension({ enableWebMcp: true });
    const { context, extensionId } = ext;
    console.log(`Chrome for Testing ${ext.buildId}; extension id: ${extensionId}`);

    const panel = await context.newPage();
    await panel.goto(sidepanelUrl(extensionId));

    // Opened AFTER the panel, so it becomes the active tab and tab-sync
    // tracks it (same ordering as liveSmoke.mjs/pageContext.mjs).
    const demoPage = await context.newPage();
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 25000,
    });

    await report.run(
      "Panel tracks the demo tab, sharing on by default (data-sharing=true)",
      async () => {
        await panel.getByText("WebMCP Demo", { exact: false }).first().waitFor({
          state: "visible",
          timeout: 30000,
        });
        const attr = await sharingAttr(panel);
        assertEqual(attr, "true", "ContextChip's data-sharing attribute on first mount");
        return { sharing: attr };
      },
    );

    await report.run(
      'While sharing: the Inspector lists all 7 demo page tools, badged "this page"',
      async () => {
        await openInspector(panel);
        for (const name of DEMO_PAGE_TOOL_NAMES) {
          await panel
            .getByText(name, { exact: true })
            .first()
            .waitFor({ state: "visible", timeout: 25000 });
        }
        const badges = panel.getByText("this page", { exact: true });
        assertEqual(
          await badges.count(),
          DEMO_PAGE_TOOL_NAMES.length,
          '"this page" origin badges while sharing',
        );
        await panel
          .getByRole("tab", { name: "Tools (7)" })
          .waitFor({ state: "visible", timeout: 15000 });
        await backToChat(panel);
        return { toolsListed: DEMO_PAGE_TOOL_NAMES.length };
      },
    );

    let expectedSelection = "";
    await report.run(
      "A real page selection -> panel focus pull -> SelectionChip appears",
      async () => {
        expectedSelection = await selectOnPage(demoPage, SELECTION_TARGET);
        assert(
          typeof expectedSelection === "string" && expectedSelection.length > 10,
          `could not put a selection on "${SELECTION_TARGET}" in the demo page`,
        );
        // The panel's own window "focus" event is what card 119's
        // initPageSharingSync pulls a fresh selection on
        // (src/sidepanel/stores/pageSharing.svelte.ts). Deliberately NOT
        // `panel.bringToFront()`: the panel here is opened as an ordinary
        // BROWSER TAB (MV3 side panel UI cannot be opened programmatically —
        // see verify/lib/browser.mjs), so activating IT would deactivate the
        // demo tab and break tab-sync's tracking entirely — measured live
        // while building this scenario: it swaps the tracked page to the
        // panel's own `chrome-extension://` tab and the whole page section
        // goes to "0 tools". In the real product the docked side panel is a
        // separate UI surface from the tab strip, so a user clicking into it
        // never changes which tab is active — dispatching the same "focus"
        // event `initPageSharingSync` listens for is the honest way to
        // reproduce that gesture without the tab-as-panel workaround fighting
        // itself.
        await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
        await panel
          .getByText("Selected text", { exact: true })
          .waitFor({ state: "visible", timeout: 25000 });
        const chipText = await panel.locator("body").innerText();
        assert(
          chipText.includes(expectedSelection.slice(0, 30)),
          `expected the SelectionChip's excerpt to contain the start of the real selection ("${expectedSelection.slice(0, 30)}"), got panel text:\n${chipText}`,
        );
        return { selection: expectedSelection };
      },
    );

    await report.run(
      'Dismiss sharing ("Stop sharing this page") -> chip gone, gate off, page tools hidden everywhere',
      async () => {
        await panel.getByRole("button", { name: "Stop sharing this page" }).click();

        assertEqual(await sharingAttr(panel), "false", "data-sharing after dismissing");
        assertEqual(
          await panel.getByText("Selected text", { exact: true }).count(),
          0,
          "SelectionChip must be gone once sharing is dismissed",
        );
        await panel.getByText("Not sharing this page", { exact: true }).first().waitFor({
          state: "visible",
          timeout: 15000,
        });
        await panel.getByRole("button", { name: "Share this page", exact: true }).waitFor({
          state: "visible",
          timeout: 15000,
        });

        await openInspector(panel);
        await panel.getByText("Not sharing this page", { exact: true }).first().waitFor({
          state: "visible",
          timeout: 15000,
        });
        for (const name of DEMO_PAGE_TOOL_NAMES) {
          assertEqual(
            await panel.getByText(name, { exact: true }).count(),
            0,
            `expected "${name}" to be hidden from the Inspector while sharing is dismissed`,
          );
        }
        // No count anywhere, per decisions/40 — the tab must not say "Tools
        // (7)" about a page it has just promised to be blind to.
        await panel
          .getByRole("tab", { name: "Tools", exact: true })
          .waitFor({ state: "visible", timeout: 15000 });
        assertEqual(
          await panel.getByRole("tab", { name: /Tools \(\d+\)/ }).count(),
          0,
          "no tool count while dismissed",
        );
        await backToChat(panel);
        return { dismissed: true };
      },
    );

    await report.run(
      '"Share this page" re-enables the gate -> tools return, and the earlier selection re-appears (never cleared, only un-pulled)',
      async () => {
        await panel.getByRole("button", { name: "Share this page", exact: true }).click();

        assertEqual(await sharingAttr(panel), "true", "data-sharing after re-enabling");
        await panel.getByText("WebMCP Demo", { exact: false }).first().waitFor({
          state: "visible",
          timeout: 25000,
        });
        await panel
          .getByText("Selected text", { exact: true })
          .waitFor({ state: "visible", timeout: 25000 });

        await openInspector(panel);
        for (const name of DEMO_PAGE_TOOL_NAMES) {
          await panel
            .getByText(name, { exact: true })
            .first()
            .waitFor({ state: "visible", timeout: 25000 });
        }
        await panel
          .getByRole("tab", { name: "Tools (7)" })
          .waitFor({ state: "visible", timeout: 15000 });
        return { reenabled: true };
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
  console.error("\nsharing gate scenario crashed before completing:", err);
  process.exitCode = 1;
});
