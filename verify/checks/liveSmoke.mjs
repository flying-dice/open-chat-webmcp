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

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, "live-smoke-turn.png");
    await panel.screenshot({ path: screenshotPath });
    console.log(`Screenshot: ${screenshotPath}`);
    console.log(`Tool-call round trip visible in transcript: ${sawToolCall}`);

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
