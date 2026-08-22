#!/usr/bin/env node
// Page-context round trip against a REAL Chrome, a REAL content relay and a
// REAL user selection (card 118,
// boards/project-backlog/118-page-context-transport.md,
// decisions/40-page-context-access.md).
//
// What the unit tests cannot reach, and this can:
//   - the DOM walk running against Chrome's own DOM rather than jsdom, with
//     `Element.checkVisibility()` actually present (jsdom has no such method,
//     so the CSS-aware half of the visibility heuristic is never exercised
//     there);
//   - a genuine `window.getSelection()` produced by a real Range in a real
//     browsing context, read back through the whole
//     panel → worker → relay hop;
//   - the RESTRICTED case as Chrome actually produces it — a `chrome://` tab,
//     where there is no content script to ask and `chrome.runtime.lastError`
//     says "Receiving end does not exist" in the exact words
//     src/background/sw.ts pattern-matches on.
//
// Drives chrome.* from an extension-origin control page (verify/lib/runtime.mjs),
// the same bypass verify/run.mjs's other checks use, so it is independent of
// whatever the side panel's Svelte UI currently renders — card 119 is what
// builds the UI over this, and this check must not depend on it.
//
// TWO WAYS TO RUN IT
//   node verify/checks/pageContext.mjs        standalone (builds + launches its own browser)
//   from verify/run.mjs                       via the exported `checkPageContext`, reusing
//                                             the control page and demo tab that run already has
//
// The standalone path exists because card 110 owns verify/run.mjs while this
// card was in flight; the export is what the coordinator wires in with one
// line (see the card's journal).

import { buildExtension } from "../lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "../lib/demoServer.mjs";
import { launchExtension, sidepanelUrl } from "../lib/browser.mjs";
import { findTabId, getPageContext } from "../lib/runtime.mjs";
import { createReport } from "../lib/report.mjs";
import { assert, pollUntil } from "../lib/assert.mjs";

/** The demo page element this check selects — one paragraph with stable, distinctive prose. */
const SELECTION_TARGET = "main .panel .hint";

/**
 * Puts a REAL selection on the demo page, the way a user dragging across a
 * paragraph would: a `Range` over one element's contents, installed on the
 * document's own `Selection`. Returns the text the browser reports as
 * selected, so the assertion compares against what Chrome thinks is selected
 * rather than against what the markup says.
 */
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

async function clearSelection(demoPage) {
  await demoPage.evaluate(() => {
    window.getSelection().removeAllRanges();
  });
}

/** Opens a `chrome://` tab (which allows no content script) and resolves its tab id. Opened through `chrome.tabs.create` from the control page rather than Playwright's `goto`, which refuses `chrome://` URLs. */
async function openRestrictedTab(controlPage) {
  return controlPage.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.tabs.create({ url: "chrome://version/", active: false }, (tab) => {
          void chrome.runtime.lastError;
          resolve(tab ? tab.id : null);
        });
      }),
  );
}

async function closeTab(controlPage, tabId) {
  await controlPage.evaluate(
    (id) =>
      new Promise((resolve) => {
        chrome.tabs.remove(id, () => {
          void chrome.runtime.lastError;
          resolve(null);
        });
      }),
    tabId,
  );
}

/**
 * The check itself. Takes an already-open control page (an extension-origin
 * tab), the demo page, and its tab id — exactly what verify/run.mjs has by
 * the time its tool-discovery check has run.
 */
export async function checkPageContext({ controlPage, demoPage, tabId }) {
  // -------------------------------------------------------------------------
  // 1. Selection: set one, pull it, and get the same text back
  // -------------------------------------------------------------------------
  const expectedSelection = await selectOnPage(demoPage, SELECTION_TARGET);
  assert(
    typeof expectedSelection === "string" && expectedSelection.length > 20,
    `could not put a selection on "${SELECTION_TARGET}" in the demo page (got: ${JSON.stringify(expectedSelection)})`,
  );

  const selectionRes = await pollUntil(
    () => getPageContext(controlPage, tabId, "selection"),
    (r) => r.ok === true && r.context?.text !== "",
    { timeoutMs: 5000, label: "the relay to report the selection just made on the demo page" },
  );
  assert(
    selectionRes.ok === true,
    `expected ok:true from a selection pull, got ${JSON.stringify(selectionRes)}`,
  );
  const selection = selectionRes.context;
  assert(selection.mode === "selection", `expected mode "selection", got ${selection.mode}`);
  assert(
    selection.text.replace(/\s+/g, " ") === expectedSelection,
    `selection round trip lost the text.\n  browser reported: ${JSON.stringify(expectedSelection)}\n  relay returned:   ${JSON.stringify(selection.text)}`,
  );
  assert(
    selection.url.includes("/index.html") && selection.title.length > 0,
    `expected the snapshot to carry the page identity, got url=${selection.url} title=${JSON.stringify(selection.title)}`,
  );
  assert(selection.truncated === false, "a short selection must not report truncated:true");
  assert(
    selection.bytes === Buffer.byteLength(selection.text, "utf8"),
    `bytes (${selection.bytes}) disagrees with the UTF-8 length of the text it describes (${Buffer.byteLength(selection.text, "utf8")})`,
  );

  // -------------------------------------------------------------------------
  // 2. No selection: an EMPTY, SUCCESSFUL answer — never an error
  // -------------------------------------------------------------------------
  await clearSelection(demoPage);
  const cleared = await pollUntil(
    () => getPageContext(controlPage, tabId, "selection"),
    (r) => r.ok === true && r.context?.text === "",
    { timeoutMs: 5000, label: "the relay to report an empty selection after it was cleared" },
  );
  assert(
    cleared.ok === true && cleared.context.text === "",
    `clearing the selection must produce an empty SUCCESS, got ${JSON.stringify(cleared)}`,
  );

  // -------------------------------------------------------------------------
  // 3. Extract: the page's own content, without its chrome
  // -------------------------------------------------------------------------
  const extractRes = await getPageContext(controlPage, tabId, "extract");
  assert(
    extractRes.ok === true,
    `expected ok:true from an extract pull, got ${JSON.stringify(extractRes)}`,
  );
  const extract = extractRes.context;
  assert(extract.mode === "extract", `expected mode "extract", got ${extract.mode}`);
  assert(extract.text.length > 100, `extract looks empty: ${JSON.stringify(extract.text)}`);

  // demo/index.html puts its content in <main> and its title/status line in a
  // sibling <header>. The <main> preference plus the noise heuristics mean the
  // headings inside main survive and the header line does not.
  for (const needle of ["Page state", "Registered tools", "Activity log"]) {
    assert(
      extract.text.includes(needle),
      `expected the extract to contain the demo page's "${needle}" heading; got:\n${extract.text.slice(0, 400)}`,
    );
  }
  assert(
    extract.text.includes("# Page state") || extract.text.includes("## Page state"),
    `expected heading markers on the demo page's <h2>s; got:\n${extract.text.slice(0, 400)}`,
  );
  assert(
    !extract.text.includes("document.modelContext"),
    "the <header> status line sits outside <main> and must not appear in the extract",
  );
  assert(
    extract.bytes === Buffer.byteLength(extract.text, "utf8"),
    `bytes (${extract.bytes}) disagrees with the UTF-8 length of the extract`,
  );

  // -------------------------------------------------------------------------
  // 4. A restricted page: no relay to ask, and it says so distinctly
  //
  // `chrome://version` rather than this harness's own extension page, and
  // that took a measurement to get right: a `chrome-extension://` tab DOES
  // receive `chrome.tabs.sendMessage` (it is an extension context, so the
  // panel's own `onMessage` listener is the receiving end) and answers
  // "The message port closed before a response was received" — an
  // `Unreachable`, not a `Restricted`. A `chrome://` page is the real thing:
  // no content script, no extension context, and Chrome reports the
  // "Receiving end does not exist" that `looksLikeNoRelay` (src/background/sw.ts)
  // pattern-matches.
  // -------------------------------------------------------------------------
  const restrictedTabId = await openRestrictedTab(controlPage);
  assert(typeof restrictedTabId === "number", "could not open a chrome:// tab to test against");
  try {
    const restricted = await getPageContext(controlPage, restrictedTabId, "extract");
    assert(
      restricted.ok === false && restricted.restricted === true,
      `a chrome:// tab must report ok:false/restricted:true, got ${JSON.stringify(restricted)}`,
    );
  } finally {
    await closeTab(controlPage, restrictedTabId);
  }

  return {
    selectionBytes: selection.bytes,
    selectionText: `${selection.text.slice(0, 60)}…`,
    emptySelectionIsSuccess: true,
    extractBytes: extract.bytes,
    extractTruncated: extract.truncated,
    restrictedReported: true,
  };
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

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

    const controlPage = await context.newPage();
    await controlPage.goto(sidepanelUrl(extensionId));

    const demoPage = await context.newPage();
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 10000,
    });

    const tabId = await pollUntil(
      () => findTabId(controlPage, DEMO_INDEX_URL),
      (id) => id !== null,
      { timeoutMs: 5000, label: "tab id for demo/index.html" },
    );

    await report.run(
      "Page context: a real selection and a real page extract round-trip panel -> worker -> relay, and a restricted tab says so",
      () => checkPageContext({ controlPage, demoPage, tabId }),
    );

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
    stopDemoServer(demoHandle);
  }
}

// Only when executed directly, never when imported by verify/run.mjs.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\npage-context probe crashed before completing:", err);
    process.exitCode = 1;
  });
}
