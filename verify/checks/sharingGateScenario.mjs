#!/usr/bin/env node
// Scenario pack (card 112, boards/project-backlog/112-verify-scenario-pack.md):
// the sharing gate + selection chip, end to end through the REAL side panel
// UI (card 119, decisions/40-page-context-access.md). No model needed — this
// never sends a chat turn, it only drives the gate itself and reads what it
// actually did to the DOM (the ContextChip's own `data-sharing` attribute,
// the SelectionChip, the Inspector's tools list) rather than asserting on
// pixels.
//
// Card 129 extended it with the LIVE half (decisions/40's "Live chip
// updates"): four steps in the middle that never touch the panel at all —
// select a different paragraph and the chip follows it, extend the selection
// and the chip grows, clear it and the chip goes away — plus one after the
// gate is dismissed, where changing the selection must produce nothing at
// all. Those are the only steps in this file with no panel interaction
// whatsoever, which is exactly what makes them a test of the relay's
// selectionchange ping rather than of the focus pull.
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

/** A DIFFERENT stable paragraph, for card 129's live-update steps: the chip has to follow the selection from one to the other with nobody touching the panel. */
const SECOND_SELECTION_TARGET = "main .panel:nth-of-type(3) .hint";

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

/**
 * Waits until the SelectionChip is showing an excerpt of `selection` (card
 * 129). Polls the panel's own text rather than a fixed sleep: the chip
 * updating is the assertion, and the ping it rides on is debounced in the
 * relay and coalesced again in the panel, so "how long" is not a number this
 * scenario should be encoding.
 */
async function waitForChipContaining(panel, selection) {
  const needle = selection.slice(0, 30);
  await panel
    .getByText("Selected text", { exact: true })
    .waitFor({ state: "visible", timeout: 25000 });
  await panel.waitForFunction((text) => document.body.innerText.includes(text), needle, {
    timeout: 25000,
  });
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

    // -----------------------------------------------------------------
    // Card 129: the chip tracks the page LIVE, with no panel interaction
    // at all. Everything below this point deliberately never touches the
    // panel between selecting and asserting — the only thing that happens
    // is a selection changing in the page, which is the whole claim.
    // -----------------------------------------------------------------

    await report.run(
      "LIVE: a NEW selection on the page, with NO panel interaction, changes the chip on its own",
      async () => {
        const second = await selectOnPage(demoPage, SECOND_SELECTION_TARGET);
        assert(
          typeof second === "string" && second.length > 10 && second !== expectedSelection,
          `could not put a DIFFERENT selection on "${SECOND_SELECTION_TARGET}" (got "${second}")`,
        );
        // No focus event, no click, no keystroke in the panel. The relay's
        // selectionchange ping is the only thing that can make this pass.
        await waitForChipContaining(panel, second);
        expectedSelection = second;
        return { chipTracked: second.slice(0, 40) };
      },
    );

    await report.run(
      "LIVE: extending the selection to the whole panel section updates the chip again",
      async () => {
        const extended = await selectOnPage(demoPage, "main .panel");
        assert(
          typeof extended === "string" && extended.length > expectedSelection.length,
          "expected the extended selection to be longer than the previous one",
        );
        await waitForChipContaining(panel, extended);
        expectedSelection = extended;
        return { extendedTo: extended.length };
      },
    );

    await report.run(
      "LIVE: clearing the selection in the page makes the chip go away on its own",
      async () => {
        await demoPage.evaluate(() => window.getSelection().removeAllRanges());
        await panel
          .getByText("Selected text", { exact: true })
          .waitFor({ state: "detached", timeout: 25000 });
        return { chipCleared: true };
      },
    );

    await report.run(
      "LIVE: re-selecting brings the chip back, so the gate test below starts from a chip on screen",
      async () => {
        expectedSelection = await selectOnPage(demoPage, SELECTION_TARGET);
        await waitForChipContaining(panel, expectedSelection);
        return { reselected: true };
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
      "LIVE + GATE: changing the selection while sharing is DISMISSED produces no chip — the ping is dropped unanswered",
      async () => {
        const ignored = await selectOnPage(demoPage, SECOND_SELECTION_TARGET);
        assert(
          typeof ignored === "string" && ignored.length > 10,
          "could not put a fresh selection on the page while dismissed",
        );
        // Generous, and deliberately so: this asserts a NON-event, so it has
        // to outlast the relay's debounce and the panel's coalescing window
        // several times over before "no chip" means anything.
        await panel.waitForTimeout(3000);
        assertEqual(
          await panel.getByText("Selected text", { exact: true }).count(),
          0,
          "a selection changed while sharing is dismissed must never produce a chip",
        );
        assertEqual(await sharingAttr(panel), "false", "gate still dismissed");
        // Put the original selection back, so the re-enable step below is
        // asserting what it always did.
        expectedSelection = await selectOnPage(demoPage, SELECTION_TARGET);
        await panel.waitForTimeout(1000);
        assertEqual(
          await panel.getByText("Selected text", { exact: true }).count(),
          0,
          "still no chip while dismissed, even for the selection that had one before",
        );
        return { pingsIgnored: true };
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
