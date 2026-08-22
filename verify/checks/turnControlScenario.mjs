#!/usr/bin/env node
// Best-effort LIVE scenario (card 112,
// boards/project-backlog/112-verify-scenario-pack.md): two mid-turn control
// flows against a REAL local Ollama, through the REAL side panel UI — a
// streaming model is required for both, so (like verify/checks/liveSmoke.mjs
// and verify/checks/approvalScenario.mjs) this is Ollama-gated and prints a
// "blocked on environment" message rather than failing when none is
// reachable.
//
// 1. STOP MID-TURN: send a long-form prompt, click Stop partway through
//    streaming, and assert the transcript stops growing and the composer
//    re-enables — state, not a screenshot of "it looks stopped".
// 2. TAB SWITCH MID-TURN (card 77's guarantee, src/sidepanel/stores/panel.svelte.ts's
//    own doc comment: "A TURN BELONGS TO A CHAT, NOT TO WHICHEVER TAB IS
//    VISIBLE"): start a long-form turn on one tab, switch the panel's
//    tracked tab away to a second one mid-stream, and assert TWO things —
//    the second tab's own (fresh, unrelated) chat shows no busy/streaming
//    state at all (no bleed), and switching back finds the first turn
//    finished cleanly in its own chat.
//
// NOT wired into `npm run verify` / `npm run guard` / CI. Run manually:
//
//   node verify/checks/turnControlScenario.mjs

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

const TURN_TIMEOUT_MS = 120000;
// Long enough that even fast local hardware (measured: a full short reply
// can land in ~4s) cannot finish generating it before this script reacts
// mid-stream — both mid-turn checks below need a genuine streaming WINDOW to
// act inside, not a turn that has already finished by the time they look.
const LONG_PROMPT =
  "Write a very long, detailed 1500-word short story, in full, right now. Do not call any " +
  "tools and do not summarize or shorten it — write the complete story at that length.";

async function countCopyResponse(panel) {
  return panel.getByRole("button", { name: "Copy response" }).count();
}

async function waitForNewReply(panel, priorCount, timeoutMs = TURN_TIMEOUT_MS) {
  return pollUntil(
    () => countCopyResponse(panel),
    (n) => n > priorCount,
    {
      timeoutMs,
      intervalMs: 500,
      label: 'a new "Copy response" button (this turn settling)',
    },
  );
}

async function waitStreamingStarted(panel) {
  // Busy state: the Stop button replaces Send the instant a turn starts
  // (Composer.svelte) — well before any tokens necessarily render, so this
  // alone isn't "streaming has produced text", only "a turn is in flight".
  await panel.getByRole("button", { name: "Stop generating" }).waitFor({
    state: "visible",
    timeout: TURN_TIMEOUT_MS,
  });
  // Wait for genuine token growth, not just the busy flag, so Stop is
  // clicked mid-stream rather than in the pre-first-token gap.
  await pollUntil(
    () => panel.locator("body").innerText(),
    (text) => text.length > 200,
    {
      timeoutMs: TURN_TIMEOUT_MS,
      intervalMs: 300,
      label: "streamed text to actually start growing",
    },
  );
}

async function main() {
  const report = createReport();
  const model = await pickToolCapableModel();

  if (!model) {
    console.log(
      "\nTurn-control scenario: BLOCKED ON ENVIRONMENT — no local Ollama reachable, or no " +
        "tool-capable model installed. Skipping; expected on a machine with no local model set up.\n",
    );
    process.exitCode = 0;
    return;
  }
  console.log(
    `Turn-control scenario: found a real, reachable Ollama with tool-capable model "${model}".`,
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

    const providerId = "turn-control-scenario-ollama";
    const providerName = "Ollama (turn control scenario)";

    const panel = await context.newPage();
    await writeLiveProviderStorage(panel, extensionId, { providerId, providerName, model });

    // Opened BEFORE the panel's reload — see reloadIntoSeededWorld's own
    // comment (verify/lib/liveOllama.mjs) for the tab-tracking race this
    // order avoids.
    const demoPageA = await context.newPage();
    await demoPageA.goto(DEMO_INDEX_URL);
    await demoPageA.waitForFunction(
      () => document.getElementById("status")?.dataset.kind === "ok",
      {
        timeout: 10000,
      },
    );
    await reloadIntoSeededWorld(panel, extensionId);

    await report.run("Real side panel picks up the active demo tab", async () => {
      // Generous for the same reason verify/checks/approvalScenario.mjs's
      // identical wait is: measured flakiness under heavy concurrent load
      // shared with the pre-existing verify/checks/liveSmoke.mjs.
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

    let replyCount = await countCopyResponse(panel);

    // -------------------------------------------------------------------
    // 1. Stop mid-turn
    // -------------------------------------------------------------------
    await report.run(
      "Stop mid-turn: click Stop while streaming -> transcript stops growing, composer re-enables",
      async () => {
        const textarea = panel.getByRole("textbox", { name: "Message" });
        await textarea.click();
        await textarea.fill(LONG_PROMPT);
        await panel.getByRole("button", { name: "Send" }).click();

        await waitStreamingStarted(panel);
        await panel.getByRole("button", { name: "Stop generating" }).click();

        // Composer re-enabled: Send is back, Stop is gone.
        await panel
          .getByRole("button", { name: "Send" })
          .waitFor({ state: "visible", timeout: 10000 });
        assert(
          (await panel.getByRole("button", { name: "Stop generating" }).count()) === 0,
          "expected the Stop button to be gone once the turn is stopped",
        );
        // On very fast local hardware the turn can finish naturally in the
        // same instant Stop is clicked, and the Stop click can land on the
        // adjacent model-picker chip once the layout reflows out from under
        // it (measured live while building this scenario: the picker's own
        // popover ended up open). Not the thing under test — close it
        // defensively before reading the transcript.
        if (await panel.getByText("Manage providers", { exact: false }).count()) {
          await panel.keyboard.press("Escape");
          await panel.getByText("Manage providers", { exact: false }).waitFor({
            state: "hidden",
            timeout: 5000,
          });
        }
        const textareaEnabled = await textarea.isEnabled();
        assert(textareaEnabled, "expected the composer's textarea to be re-enabled after Stop");

        // "Left consistent": the transcript must not keep changing after
        // Stop — read it twice, a beat apart, and require it settled.
        const first = await panel.locator("body").innerText();
        await new Promise((r) => setTimeout(r, 1500));
        const second = await panel.locator("body").innerText();
        assertStable(first, second);

        replyCount = await countCopyResponse(panel);
        return { stoppedLength: second.length };
      },
    );

    // -------------------------------------------------------------------
    // 2. Tab switch mid-turn — card 77's "a turn belongs to a chat, not to
    //    whichever tab is visible" guarantee.
    // -------------------------------------------------------------------
    let demoPageB;
    try {
      await report.run(
        "Tab switch mid-turn: switching the tracked tab away shows NO busy state on the unrelated tab's own chat",
        async () => {
          // The previous check stopped a turn, and the loop's own post-stop
          // cleanup (closing the assistant message, clearing streaming
          // state) can still be landing for a moment after "the transcript
          // stopped changing" was observed — wait for the idle Send button
          // to be genuinely settled before typing into it.
          await panel
            .getByRole("button", { name: "Send" })
            .waitFor({ state: "visible", timeout: 15000 });
          const textarea = panel.getByRole("textbox", { name: "Message" });
          await textarea.click();
          await textarea.fill(LONG_PROMPT);
          await panel.getByRole("button", { name: "Send" }).click();
          await waitStreamingStarted(panel);

          // A second, same-origin demo tab — its own tab id means its own
          // (brand-new, empty) chat, per src/infra/chrome-runtime/tab-sync.ts's
          // per-tab pointer (tabchat:<tabId>). Bringing it to front is a real
          // Chrome tab activation, exactly what a person switching tabs does.
          //
          // Created HERE, deliberately, not before this turn was already
          // sent: `context.newPage()` activates the new tab immediately on
          // creation (measured live while building this scenario — creating
          // it earlier raced tab-sync into swapping the panel to its fresh
          // chat BEFORE the turn-2 message had even been typed, detaching
          // the very textarea this function was about to click).
          demoPageB = await context.newPage();
          await demoPageB.goto(DEMO_INDEX_URL);
          await demoPageB.waitForFunction(
            () => document.getElementById("status")?.dataset.kind === "ok",
            { timeout: 10000 },
          );
          await demoPageB.bringToFront();

          // Wait for the panel to actually swap chats: the composer becomes
          // idle (no Stop button) for what is now a DIFFERENT, unrelated
          // chat — the no-bleed assertion itself.
          await pollUntil(
            () => panel.getByRole("button", { name: "Stop generating" }).count(),
            (n) => n === 0,
            {
              timeoutMs: 15000,
              intervalMs: 300,
              label: "the panel to show the new tab's idle (non-busy) chat",
            },
          );
          const bodyText = await panel.locator("body").innerText();
          assert(
            !bodyText.includes(LONG_PROMPT),
            "the new tab's fresh chat must not show the OTHER chat's in-flight prompt (no bleed)",
          );
          return { switchedWithNoBleed: true };
        },
      );

      await report.run(
        "Switching back finds the original turn finished cleanly in its own chat",
        async () => {
          await demoPageA.bringToFront();
          // The turn kept running in the background the whole time we were
          // looking at the other tab's chat — this is card 77's guarantee,
          // proven by the reply actually completing once we look again.
          replyCount = await waitForNewReply(panel, replyCount);
          const bodyText = await panel.locator("body").innerText();
          assert(
            bodyText.length > 200,
            "expected the original chat's finished reply to still be there after switching back",
          );
          return { resumed: true };
        },
      );
    } finally {
      if (demoPageB) await demoPageB.close();
    }

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
    stopDemoServer(demoHandle);
  }
}

/** Throws if two body-text snapshots disagree — the transcript grew or changed after it should have settled. */
function assertStable(before, after) {
  assert(
    before === after,
    `expected the transcript to stay unchanged after Stop, but it kept changing.\n  before: ${before.slice(-200)}\n  after:  ${after.slice(-200)}`,
  );
}

main().catch((err) => {
  console.error("\nturn-control scenario crashed before completing:", err);
  process.exitCode = 1;
});
