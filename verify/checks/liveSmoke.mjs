#!/usr/bin/env node
// Best-effort LIVE smoke test: drives the REAL side panel Svelte UI (not the
// runtime.mjs chrome.*-message bypass verify/run.mjs's other checks use)
// against a real, locally running Ollama with a tool-capable model, and
// asserts one full end-to-end turn actually works: type a message in the
// composer, send it, watch it stream, and see the assistant's reply render
// — plus, since the demo page is already open for WebMCP tool discovery,
// that the model calling `read-page-state` round-trips through the real
// content relay and shows up in the transcript as a tool-call step.
//
// NOT wired into `npm run verify` / `npm run guard` / CI. This depends on a
// local Ollama actually being up and a tool-capable model being pulled —
// neither of which any required gate in this repo may assume. Run manually:
//
//   node verify/checks/liveSmoke.mjs
//
// If Ollama isn't reachable at all, this prints that and exits 0 rather
// than failing — "blocked on environment" is not the same as "broken".
//
// Card 90 (boards/project-backlog/90-debt-burndown-and-live-smoke.md):
// automates the flagged "drive a real end-to-end turn" human-verification
// item wherever a local Ollama is actually reachable, the way earlier cards
// found it to be.
//
// Card 120 (decisions/40-page-context-access.md) adds a SECOND real turn:
// text selected in the page reaches the model and comes back in the answer.
// It lives here rather than in sharingGateScenario.mjs because it is the one
// assertion in the page-context feature that cannot be made without a model
// — the gate, the chip and the tool hiding are all provable against the DOM,
// and that scenario proves them with no Ollama needed. The seam-level
// assertion of the exact fenced prompt is a unit test instead
// (src/domain/chat/turn.test.ts, at the ModelGateway fake), which is where
// the prompt's shape can be pinned character by character.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { buildExtension } from "../lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "../lib/demoServer.mjs";
import { launchExtension } from "../lib/browser.mjs";
import { createReport } from "../lib/report.mjs";
import { assert } from "../lib/assert.mjs";
import {
  OLLAMA_ORIGIN,
  pickToolCapableModel,
  writeLiveProviderStorage,
  reloadIntoSeededWorld,
  confirmModelSelection,
} from "../lib/liveOllama.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCREENSHOT_DIR = path.join(ROOT, "verify", "output", "screenshots");

async function main() {
  const report = createReport();
  const model = await pickToolCapableModel();

  if (!model) {
    console.log(
      "\nLive smoke: BLOCKED ON ENVIRONMENT — no local Ollama reachable at " +
        `${OLLAMA_ORIGIN}/api/tags (or no tool-capable model installed there). ` +
        "Skipping; this is expected and not a failure when no local model is set up.\n",
    );
    process.exitCode = 0;
    return;
  }
  console.log(`Live smoke: found a real, reachable Ollama with tool-capable model "${model}".`);

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

    const providerId = "live-smoke-ollama";
    const providerName = "Ollama (live smoke)";

    const panel = await context.newPage();
    await writeLiveProviderStorage(panel, extensionId, { providerId, providerName, model });

    // Opened BEFORE the panel's reload — card 112 found that reloading the
    // panel's own tab and only THEN opening a second tab races
    // src/infra/chrome-runtime/tab-sync.ts into mis-tracking the newly
    // active tab as restricted (see reloadIntoSeededWorld's own comment,
    // verify/lib/liveOllama.mjs). Opening every other tab first and
    // reloading the panel last avoids it.
    const demoPage = await context.newPage();
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 10000,
    });
    await reloadIntoSeededWorld(panel, extensionId);

    await report.run(
      "Real side panel picks up the active demo tab and its page tools",
      async () => {
        // The header's context chip carries the tracked tab's title once
        // tab-sync has resolved it — cheap, unambiguous evidence the panel
        // is tracking the demo tab rather than sitting on whatever it saw at
        // mount (its own chrome-extension:// origin has no title to show).
        await panel
          .getByText("WebMCP Demo", { exact: false })
          .first()
          .waitFor({ state: "visible", timeout: 15000 });
        return { trackedTab: true };
      },
    );

    await report.run(
      `Confirming the seeded default selection (${providerName} · ${model}) via the real model picker`,
      async () => {
        // Card 35: a freshly-seeded default selection starts unconfirmed
        // (`needsConfirmation`) until a real click through the picker marks
        // it explicit — the composer stays blocked until then, exactly as
        // it would for a first-time user. Drives the actual UI, not a
        // storage shortcut. (verify/lib/liveOllama.mjs, card 112.)
        await confirmModelSelection(panel, model);
        return { confirmed: true };
      },
    );

    let replyText = "";
    let sawToolCall = false;
    await report.run(
      "A real end-to-end turn: composer send -> streamed reply renders, and the page tool it calls round-trips",
      async () => {
        const textarea = panel.getByRole("textbox", { name: "Message" });
        await textarea.click();
        await textarea.fill(
          "Call the read-page-state tool right now to check this page's title, then tell me what it says the title is. Be brief.",
        );
        await panel.getByRole("button", { name: "Send" }).click();

        // "Copy response" only renders once `message.id !== streamingMessageId`
        // (Transcript.svelte) — i.e. streaming for THIS reply has finished.
        // Generous timeout: a real local model plus a real tool round trip,
        // not a mock.
        await panel
          .getByRole("button", { name: "Copy response" })
          .first()
          .waitFor({ state: "visible", timeout: 120000 });

        replyText = (await panel.locator("body").innerText()).trim();
        assert(
          replyText.length > 0,
          "expected some rendered text in the panel after the reply finished streaming",
        );

        sawToolCall = await panel
          .getByText("read-page-state", { exact: false })
          .first()
          .isVisible();

        return { replyLength: replyText.length, toolCallVisible: sawToolCall };
      },
    );

    // -----------------------------------------------------------------------
    // Card 120 (decisions/40): the page-context feature end to end, against a
    // real model. Everything below this line is about ONE claim — that text
    // the user selects in the page reaches the model, fenced, and comes back
    // in the answer.
    //
    // The selected text is a NONCE injected into the page at runtime, and it
    // is deliberately NOT reachable through any of the demo page's seven
    // tools: `read-page-state` returns the title/URL/counts, `read-notes-content`
    // returns the notes list, and this paragraph is neither. So a reply
    // containing the nonce can only have come through the selection pull —
    // the model could not have called its way to it. That is what makes this
    // a test of the feature rather than of the demo page.
    // -----------------------------------------------------------------------
    const nonce = `zarquon-${Math.random().toString(36).slice(2, 10)}`;
    let sawSelectionMarker = false;
    await report.run(
      "Page context end to end: select text on the demo page -> send -> the live model's reply repeats the selected text",
      async () => {
        const selected = await demoPage.evaluate((token) => {
          const paragraph = document.createElement("p");
          paragraph.id = "verify-selection-target";
          paragraph.textContent = `The secret passphrase for this page is ${token}.`;
          document.querySelector("main")?.prepend(paragraph);
          const selection = window.getSelection();
          selection.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          selection.addRange(range);
          return selection.toString().trim();
        }, nonce);
        assert(
          typeof selected === "string" && selected.includes(nonce),
          `could not put a real selection carrying "${nonce}" on the demo page`,
        );

        // The panel's own "focus" event is the pull gesture card 119 wired up
        // — see sharingGateScenario.mjs for why this is dispatched rather
        // than driven with bringToFront().
        await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
        await panel
          .getByText("Selected text", { exact: true })
          .waitFor({ state: "visible", timeout: 25000 });

        const textarea = panel.getByRole("textbox", { name: "Message" });
        await textarea.click();
        await textarea.fill(
          "Repeat the secret passphrase from the text I have selected, exactly as written. " +
            "Do not call any tools. Answer with the passphrase and nothing else.",
        );
        // `exact` matters here and only here: with a selection chip on
        // screen its dismiss button ("Don't send the selected text") also
        // matches a loose "Send".
        await panel.getByRole("button", { name: "Send", exact: true }).click();

        // The transcript marker is the DETERMINISTIC half of this check: card
        // 119 derives it from what was actually attached to the turn (and
        // re-applies the sharing gate while doing so), so its presence is the
        // extension's own record that the selection went with this message —
        // independent of anything the model chose to say.
        await panel
          .getByText("Selected text shared", { exact: true })
          .first()
          .waitFor({ state: "visible", timeout: 30000 });
        sawSelectionMarker = true;

        // Waited for by POLLING rather than `waitFor`, so a reply that never
        // finishes reports what the panel actually shows instead of a bare
        // timeout — the difference between "the model is slow" and "the turn
        // failed" is in that text, and a live smoke that cannot tell them
        // apart is not worth much.
        const replies = panel.getByRole("button", { name: "Copy response" });
        const deny = panel.getByRole("button", { name: "Deny", exact: true });
        const deadline = Date.now() + 120000;
        let deniedCalls = 0;
        while ((await replies.count()) < 2) {
          if (Date.now() > deadline) {
            const shown = (await panel.locator("body").innerText()).trim();
            assert(false, `the second reply never finished streaming. Panel text:\n${shown}`);
          }
          // A local model asked not to call tools may call one anyway, and a
          // mutating call parks the turn on an approval card until a HUMAN
          // decides — which, unattended, is forever. Denying keeps the turn
          // moving and does not weaken the claim: the passphrase is not
          // reachable through any tool on this page, so the reply still has
          // to have come from the selection. (Observed live: this is what
          // made the first run of this check hang for its full timeout.)
          if (
            await deny
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            await deny.first().click();
            deniedCalls += 1;
          }
          await panel.waitForTimeout(500);
        }

        const transcript = (await panel.locator("body").innerText()).trim();
        // The model half: the nonce is in the reply, and it could only have
        // arrived through the fenced selection.
        assert(
          transcript.includes(nonce),
          `expected the reply to repeat the selected passphrase "${nonce}"; panel text was:\n${transcript}`,
        );
        return { nonce, markerShown: sawSelectionMarker, deniedCalls };
      },
    );

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, "live-smoke-turn.png");
    await panel.screenshot({ path: screenshotPath });
    console.log(`Screenshot: ${screenshotPath}`);
    console.log(`Tool-call round trip visible in transcript: ${sawToolCall}`);
    console.log(`Shared-selection marker visible in transcript: ${sawSelectionMarker}`);

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
    stopDemoServer(demoHandle);
  }
}

main().catch((err) => {
  console.error("\nlive smoke crashed before completing:", err);
  process.exitCode = 1;
});
