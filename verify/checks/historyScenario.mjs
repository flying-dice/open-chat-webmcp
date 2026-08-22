#!/usr/bin/env node
// Scenario pack (card 112, boards/project-backlog/112-verify-scenario-pack.md):
// History via the REAL UI — open a previous chat, delete another, delete the
// rest, reach the genuine empty state. Seeded, no model needed: this drives
// src/sidepanel/components/HistoryPanel.svelte end to end against the same
// six-chat fixture verify/checks/screenshots.mjs and `npm run dev:seed` share
// (src/infra/chrome-storage/testing/storage-fixtures.mjs), and asserts both
// the DOM (rows appear/disappear, the empty state renders) and the
// underlying `chrome.storage` (the tab pointer moves, `chat:index` actually
// shrinks to nothing) — not just what a screenshot would show.
//
// The "reach empty state" step relies on a real behaviour of
// src/domain/chat/service.ts's `startNewChat`: a fresh chat created when the
// currently-open one is deleted is carried IN MEMORY ONLY until it gets its
// first message (see that function's own comment — persisting an empty
// placeholder immediately would put a "(no messages yet)" row at the top of
// History). Since this scenario never sends a message, deleting all six
// seeded chats — including the one left open — genuinely empties the list
// rather than leaving one stray behind.
//
// NOT wired into `npm run verify` / `npm run guard` / CI, same posture as the
// existing smokes. Run manually:
//
//   node verify/checks/historyScenario.mjs

import { buildExtension } from "../lib/build.mjs";
import { launchExtension } from "../lib/browser.mjs";
import { installPanelFixtureStubs, seedExtensionStorage } from "../lib/seed.mjs";
import { createReport } from "../lib/report.mjs";
import { assert, assertEqual } from "../lib/assert.mjs";
import {
  FIXTURE_CHAT_PROMPTS,
  FIXTURE_CHAT_IDS,
  FIXTURE_CHAT_COUNT,
  FIXTURE_TAB_ID,
} from "../../src/infra/chrome-storage/testing/storage-fixtures.mjs";

// HistoryListItem.svelte renders each row's title through `titleFromSummary`
// (src/domain/chat/title.ts), which truncates to `TITLE_MAX_LENGTH` (48
// chars) + "…" — genuinely, in the DOM, not just visually via CSS (measured
// live while building this scenario: matching the full ~57-char prompt
// against a truncated 48-char title finds nothing). A 30-char prefix is
// short enough to survive that truncation for every seeded prompt while
// still being distinctive between them.
const TITLE_PREFIX_LEN = 30;

function titleNeedle(index) {
  return FIXTURE_CHAT_PROMPTS[index].slice(0, TITLE_PREFIX_LEN);
}

async function openHistory(panel) {
  await panel.getByRole("button", { name: "More options" }).click();
  await panel.getByRole("menuitem", { name: "More" }).click();
}

async function readChatIndexIds(panel) {
  return panel.evaluate(async () => {
    const { "chat:index": index } = await chrome.storage.local.get("chat:index");
    return Array.isArray(index) ? index.map((s) => s.id) : [];
  });
}

async function readTabPointer(panel, tabId) {
  return panel.evaluate(async (id) => {
    const key = `tabchat:${id}`;
    const stored = await chrome.storage.local.get(key);
    return stored[key]?.chatId;
  }, tabId);
}

async function main() {
  const report = createReport();

  console.log("Building extension -> dist-verify/ ...");
  await buildExtension();
  console.log("Build OK.");

  let ext = null;
  try {
    console.log("Launching Chrome for Testing with the built extension, WebMCP enabled ...");
    ext = await launchExtension({ enableWebMcp: true });
    const { context, extensionId } = ext;
    console.log(`Chrome for Testing ${ext.buildId}; extension id: ${extensionId}`);

    const panel = await context.newPage();
    panel.on("dialog", (d) => d.accept()); // HistoryPanel's delete confirm is a native window.confirm()

    // Must be installed BEFORE the first navigation: the panel queries
    // chrome.tabs during mount (verify/lib/seed.mjs).
    await installPanelFixtureStubs(panel);
    await seedExtensionStorage(panel, extensionId);

    await report.run(
      `Seeded world: chat:index has all ${FIXTURE_CHAT_COUNT} fixture chats`,
      async () => {
        const ids = await readChatIndexIds(panel);
        assertEqual(ids.length, FIXTURE_CHAT_COUNT, "chat:index length after seeding");
        for (const id of FIXTURE_CHAT_IDS) {
          assert(ids.includes(id), `expected chat:index to include seeded chat "${id}"`);
        }
        return { ids };
      },
    );

    await report.run("Open History via the real overflow menu and see all six rows", async () => {
      await openHistory(panel);
      const rows = panel.getByRole("listitem");
      await rows.first().waitFor({ state: "visible", timeout: 20000 });
      assertEqual(await rows.count(), FIXTURE_CHAT_COUNT, "history row count");
      for (let i = 0; i < FIXTURE_CHAT_PROMPTS.length; i++) {
        await panel.getByText(titleNeedle(i), { exact: false }).first().waitFor({
          state: "visible",
          timeout: 15000,
        });
      }
      return { rows: FIXTURE_CHAT_COUNT };
    });

    // Open a chat that is NOT the one the tab pointer currently targets
    // (index 0 is the newest and is what seeding pointed the fixture tab at)
    // — opening index 2 is a real navigation, not a no-op.
    const OPEN_INDEX = 2;
    await report.run(
      `Open a previous chat (index ${OPEN_INDEX}) via its real row -> switches to Chat view with its own transcript`,
      async () => {
        const row = panel.getByRole("listitem").filter({ hasText: titleNeedle(OPEN_INDEX) });
        await row.getByText(titleNeedle(OPEN_INDEX), { exact: false }).click();
        // HistoryPanel's onOpenChat only fires once the open genuinely
        // succeeded, and switches the view back to Chat — proven by THAT
        // chat's own transcript rendering. (Not the composer's textarea:
        // it's legitimately absent whenever the composer is in a "blocked"
        // state — e.g. no confirmed provider — which is a fact about
        // provider selection, orthogonal to whether History opened the
        // right chat, so asserting on it here would couple this scenario to
        // a different feature's state.)
        await panel.getByText(FIXTURE_CHAT_PROMPTS[OPEN_INDEX], { exact: false }).first().waitFor({
          state: "visible",
          timeout: 15000,
        });
        const pointer = await readTabPointer(panel, FIXTURE_TAB_ID);
        assertEqual(
          pointer,
          FIXTURE_CHAT_IDS[OPEN_INDEX],
          "tabchat: pointer after opening a history entry",
        );
        return { openedChatId: pointer };
      },
    );

    // Delete a DIFFERENT chat than the one just opened, while back in
    // History — proves delete doesn't require the row to be the active one.
    const DELETE_FIRST_INDEX = 5;
    await report.run(
      `Delete a different chat (index ${DELETE_FIRST_INDEX}) from History; row disappears and chat:index shrinks`,
      async () => {
        await openHistory(panel);
        const row = panel
          .getByRole("listitem")
          .filter({ hasText: titleNeedle(DELETE_FIRST_INDEX) });
        await row.waitFor({ state: "visible", timeout: 15000 });
        await row.getByRole("button", { name: /^Delete chat from/ }).click();
        await row.waitFor({ state: "detached", timeout: 20000 });
        const ids = await readChatIndexIds(panel);
        assertEqual(ids.length, FIXTURE_CHAT_COUNT - 1, "chat:index length after one delete");
        assert(
          !ids.includes(FIXTURE_CHAT_IDS[DELETE_FIRST_INDEX]),
          "deleted chat's id must be gone from chat:index",
        );
        return { remaining: ids.length };
      },
    );

    await report.run(
      "Delete every remaining chat (including the one left open) and reach the genuine empty state",
      async () => {
        const remainingIndexes = FIXTURE_CHAT_PROMPTS.map((_, i) => i).filter(
          (i) => i !== DELETE_FIRST_INDEX,
        );
        for (const i of remainingIndexes) {
          const row = panel.getByRole("listitem").filter({ hasText: titleNeedle(i) });
          await row.waitFor({ state: "visible", timeout: 15000 });
          await row.getByRole("button", { name: /^Delete chat from/ }).click();
          await row.waitFor({ state: "detached", timeout: 20000 });
        }

        await panel.getByText("No chats yet", { exact: true }).waitFor({
          state: "visible",
          timeout: 20000,
        });
        assertEqual(
          await panel.getByRole("listitem").count(),
          0,
          "history rows after deleting every seeded chat",
        );
        const ids = await readChatIndexIds(panel);
        assertEqual(ids.length, 0, "chat:index length at empty state");
        // The fresh chat startNewChat creates for the now-deleted current
        // chat is carried in memory only (see this file's header comment) —
        // the tab pointer must have moved off every deleted id, but nothing
        // new is required to have been written for the empty state to be
        // genuine.
        const pointer = await readTabPointer(panel, FIXTURE_TAB_ID);
        assert(
          !FIXTURE_CHAT_IDS.includes(pointer),
          `expected the tab pointer to have moved off every deleted seeded id, got ${pointer}`,
        );
        return { emptyState: true, chatIndexLength: 0 };
      },
    );

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
  }
}

main().catch((err) => {
  console.error("\nhistory scenario crashed before completing:", err);
  process.exitCode = 1;
});
