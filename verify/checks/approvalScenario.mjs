#!/usr/bin/env node
// Best-effort LIVE scenario (card 112,
// boards/project-backlog/112-verify-scenario-pack.md): the approval flow,
// end to end through the REAL side panel UI and a REAL local Ollama.
//
// WHY THIS NEEDS A REAL MODEL, AND ISN'T A HONEST SHORTCUT. `ApprovalCard`
// only ever renders because `src/domain/chat/turn.ts`'s agent loop is
// genuinely `await`ing a human decision mid-turn, having ALREADY decided —
// via `ApprovalPolicyGate` (src/domain/settings/approval-policy.ts) — that
// this specific tool call needs one. There is no scripted ModelGateway in
// this harness (by design: verify/ drives the real chrome.* surface and the
// real Svelte UI, never a fake provider), and the runtime:call-tool bypass
// verify/run.mjs's other checks use skips the agent loop entirely — it can
// prove a tool executes, but never that the APPROVAL SEAM itself renders,
// blocks, and resumes. The only honest way to reach `ApprovalCard` is what
// this script does: a real model, told to call a real non-auto-run demo
// tool, and the human decision it is actually written to see.
//
// The demo tool used is `add-note` (demo/src/tools.ts) — deliberately
// UNANNOTATED (no `readOnlyHint`), which decisions/17 treats as "requires
// approval" under the seeded `"default"` approval policy, unlike every other
// demo tool (all `readOnlyHint: true`).
//
// Three turns, one seeded panel session, proving all three decisions the
// card asks for:
//   1. deny -> the call log records the denial, the transcript says so
//   2. approve with "don't ask again for this tool on this page" checked ->
//      the tool actually runs (a new note lands on the demo page)
//   3. skip-for-session is honoured -> the SAME tool call now runs with NO
//      approval card at all
//
// NOT wired into `npm run verify` / `npm run guard` / CI. Needs a local
// Ollama with a tool-capable model; if none is reachable this prints that
// and exits 0 rather than failing — "blocked on environment" is not the
// same as "broken" (same posture as verify/checks/liveSmoke.mjs). Run
// manually:
//
//   node verify/checks/approvalScenario.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { buildExtension } from "../lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "../lib/demoServer.mjs";
import { launchExtension } from "../lib/browser.mjs";
import { createReport } from "../lib/report.mjs";
import { assert, pollUntil } from "../lib/assert.mjs";
import {
  pickToolCapableModel,
  writeLiveProviderStorage,
  reloadIntoSeededWorld,
  confirmModelSelection,
} from "../lib/liveOllama.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCREENSHOT_DIR = path.join(ROOT, "verify", "output", "screenshots");
const TURN_TIMEOUT_MS = 240000;

function addNotePrompt(text) {
  return (
    `Call the add-note tool right now with the exact argument text "${text}". ` +
    "Call that tool exactly once and do not call any other tool. Do not ask for " +
    "permission in your reply — just call it."
  );
}

async function sendAndWaitApprovalCard(panel, text) {
  const textarea = panel.getByRole("textbox", { name: "Message" });
  await textarea.click();
  await textarea.fill(addNotePrompt(text));
  await panel.getByRole("button", { name: "Send" }).click();
  // NOT a literal "Approval needed: add-note" match: ApprovalCard.svelte's
  // aria-label runs the tool name through `isolateLtr` (src/ui/bidi.ts),
  // which wraps it in U+2066 LEFT-TO-RIGHT ISOLATE / U+2069 POP DIRECTIONAL
  // ISOLATE — invisible on screen but real characters in the accessible
  // name, so a plain "Approval needed: add-note" regex never matches
  // (measured live while building this scenario: the card was genuinely on
  // screen, visibly correct, while this exact wait timed out). Matching on
  // "add-note" alone sidesteps the isolate marks entirely.
  const card = panel.getByRole("group", { name: /add-note/ });
  await card.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  return card;
}

/**
 * "Copy response" only renders once streaming for that reply has finished
 * (Transcript.svelte) — the same signal verify/checks/liveSmoke.mjs uses.
 * `.last()` alone is not enough across THREE turns in one session: if an
 * earlier turn already left a "Copy response" button on screen, `.last()`
 * would resolve on THAT stale button instead of waiting for a new one, so
 * this polls for the COUNT to grow past what it was before this turn's send
 * — real evidence a new reply settled, not just that some reply once did.
 * Returns the new count, to hand to the next call.
 */
async function waitTurnSettled(panel, priorCount) {
  return pollUntil(
    () => panel.getByRole("button", { name: "Copy response" }).count(),
    (n) => n > priorCount,
    {
      timeoutMs: TURN_TIMEOUT_MS,
      intervalMs: 500,
      label: 'a new "Copy response" button (this turn settling)',
    },
  );
}

async function main() {
  const report = createReport();
  const model = await pickToolCapableModel();

  if (!model) {
    console.log(
      "\nApproval scenario: BLOCKED ON ENVIRONMENT — no local Ollama reachable, or no " +
        "tool-capable model installed. Skipping; expected on a machine with no local model set up.\n",
    );
    process.exitCode = 0;
    return;
  }
  console.log(
    `Approval scenario: found a real, reachable Ollama with tool-capable model "${model}".`,
  );

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

    const providerId = "approval-scenario-ollama";
    const providerName = "Ollama (approval scenario)";

    const panel = await context.newPage();
    // approvalPolicy defaults to "default" (decisions/05) — add-note has no
    // annotations, so it needs a human decision under this policy.
    await writeLiveProviderStorage(panel, extensionId, { providerId, providerName, model });

    // Opened BEFORE the panel's reload — see reloadIntoSeededWorld's own
    // comment (verify/lib/liveOllama.mjs) for the tab-tracking race this
    // order avoids.
    const demoPage = await context.newPage();
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 10000,
    });
    await reloadIntoSeededWorld(panel, extensionId);

    await report.run("Real side panel picks up the active demo tab", async () => {
      // Generous: under heavy concurrent system load this has been measured
      // to legitimately take longer than a tighter timeout allows — the SAME
      // flakiness class verify/checks/liveSmoke.mjs's identical assertion
      // shows on this exact machine, not something specific to this script.
      await panel.getByText("WebMCP Demo", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 45000,
      });
      return { tracked: true };
    });

    await report.run(
      `Confirming the seeded default selection (${providerName} · ${model}) via the real model picker`,
      async () => {
        await confirmModelSelection(panel, model);
        return { confirmed: true };
      },
    );

    let replyCount = 0;

    // -------------------------------------------------------------------
    // Turn 1: DENY -> the call log records it, the transcript says so
    // -------------------------------------------------------------------
    await report.run(
      "Turn 1: a non-auto-run tool call -> ApprovalCard renders -> Deny -> denial recorded in the transcript and the call log",
      async () => {
        // sendAndWaitApprovalCard's own locator (role "group", accessible
        // name matching /add-note/) is already the proof this card is for
        // the right tool — a second, redundant text search inside it found
        // a DIFFERENT, unrelated hidden "add-note" span in one run while
        // building this scenario (ToolListItem.svelte renders the same
        // literal text elsewhere in the DOM), so it is not repeated here.
        const card = await sendAndWaitApprovalCard(panel, "verify scenario one");
        await card.getByRole("button", { name: "Deny", exact: true }).click();
        await card.waitFor({ state: "detached", timeout: 10000 });

        await panel.getByText("You denied this call.", { exact: true }).first().waitFor({
          state: "visible",
          timeout: 15000,
        });
        replyCount = await waitTurnSettled(panel, replyCount);

        await panel.getByRole("button", { name: "More options" }).click();
        await panel.getByRole("menuitem", { name: "Tools & call log" }).click();
        await panel.getByRole("tab", { name: /Call log/ }).click();
        // Scoped to the tabpanel, not the whole page: the Tools tab's own
        // content stays mounted (hidden) while Call log is active, and it
        // ALSO renders an "add-note" ToolListItem (add-note is one of the
        // 7 demo tools) — an unscoped search's `.first()` can resolve to
        // that hidden copy instead of the call log entry, and then never
        // become visible (measured live while building this scenario).
        const logPanel = panel.getByRole("tabpanel");
        await logPanel.getByText("add-note", { exact: true }).first().waitFor({
          state: "visible",
          timeout: 10000,
        });
        await logPanel.getByText("denied", { exact: true }).first().waitFor({
          state: "visible",
          timeout: 5000,
        });
        await panel.getByRole("button", { name: "Back to chat" }).click();
        return { denied: true, recordedInCallLog: true };
      },
    );

    // -------------------------------------------------------------------
    // Turn 2: APPROVE + "don't ask again" -> the tool actually runs
    // -------------------------------------------------------------------
    await report.run(
      'Turn 2: ApprovalCard renders again -> check "don\'t ask again for this tool on this page" -> Approve -> the tool actually runs',
      async () => {
        const card = await sendAndWaitApprovalCard(panel, "verify scenario two");
        await card.locator('input[type="checkbox"]').check();
        await card.getByRole("button", { name: "Approve", exact: true }).click();
        await card.waitFor({ state: "detached", timeout: 10000 });

        await demoPage
          .locator("#notes-list li", { hasText: "verify scenario two" })
          .waitFor({ state: "visible", timeout: 20000 });
        replyCount = await waitTurnSettled(panel, replyCount);
        return { approved: true, noteAdded: true };
      },
    );

    // -------------------------------------------------------------------
    // Turn 3: skip-for-session honoured -> no card at all
    // -------------------------------------------------------------------
    await report.run(
      "Turn 3: the same tool call now auto-runs with NO ApprovalCard at all (skip-for-session honoured)",
      async () => {
        const textarea = panel.getByRole("textbox", { name: "Message" });
        await textarea.click();
        await textarea.fill(addNotePrompt("verify scenario three"));
        await panel.getByRole("button", { name: "Send" }).click();

        // If skip-for-session were NOT honoured, an ApprovalCard would sit
        // here forever (nobody clicks it) and this note would never appear
        // within the timeout — that absence IS the proof, not just the
        // explicit card-count assertion below.
        await demoPage
          .locator("#notes-list li", { hasText: "verify scenario three" })
          .waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });

        assert(
          (await panel.getByText("Approval needed", { exact: false }).count()) === 0,
          "expected no ApprovalCard to have appeared for the skip-for-session call",
        );
        replyCount = await waitTurnSettled(panel, replyCount);
        return { autoRan: true, noCardShown: true };
      },
    );

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, "approval-scenario-final.png");
    await panel.screenshot({ path: screenshotPath });
    console.log(`Screenshot: ${screenshotPath}`);

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
    stopDemoServer(demoHandle);
  }
}

main().catch((err) => {
  console.error("\napproval scenario crashed before completing:", err);
  process.exitCode = 1;
});
