// Seeding a launched browser's extension storage from the ONE typed fixture
// (src/infra/chrome-storage/testing/storage-fixtures.mjs).
//
// Extracted from verify/checks/screenshots.mjs by card 110, because
// `npm run dev:chrome -- --seed` needs exactly the same two-step: the
// screenshot check and the dev loop must open onto the SAME seeded world, or
// "it looks right in the screenshots" stops meaning anything about what a
// developer sees. The fixture records themselves were already shared (card
// 86); this is the mechanism that writes them.
//
// Nothing here declares any storage shape of its own — every record comes
// from the fixture module, which is JSDoc-typed against the real domain types
// and round-tripped through the real adapters by a Vitest test.

import {
  buildStorageFixture,
  FIXTURE_LOCAL_KEY_PREFIXES,
  FIXTURE_PAGE_TOOLS,
  FIXTURE_TAB,
} from "../../src/infra/chrome-storage/testing/storage-fixtures.mjs";
import { sidepanelUrl } from "./browser.mjs";

/**
 * Writes the fixture into the extension's own `chrome.storage` from an
 * extension-origin page, and leaves `page` sitting on the side panel with the
 * seeded world loaded.
 *
 * Seeding has to complete BEFORE the app mounts and reads storage, and
 * `chrome.storage` writes are async — doing it inside an init script races
 * the stores' initial load and loses. So: navigate once to get an
 * extension-origin context, write, then reload into a seeded world.
 *
 * The fixture-owned keyspace is CLEARED first (`chat:` and `tabchat:`), so
 * re-seeding replaces the seeded world rather than piling a second copy on
 * top of it — including the empty chats a panel legitimately persists for
 * every extension tab it has been mounted on.
 *
 * @param {import("playwright").Page} page
 * @param {string} extensionId
 */
export async function seedExtensionStorage(page, extensionId) {
  await page.goto(sidepanelUrl(extensionId));
  await page.evaluate(
    async ({ local, sync, ownedPrefixes }) => {
      const existing = await chrome.storage.local.get(null);
      const stale = Object.keys(existing).filter((k) => ownedPrefixes.some((p) => k.startsWith(p)));
      if (stale.length > 0) await chrome.storage.local.remove(stale);

      await chrome.storage.local.set(local);
      await chrome.storage.sync.set(sync);
    },
    { ...buildStorageFixture(), ownedPrefixes: FIXTURE_LOCAL_KEY_PREFIXES },
  );
}

/**
 * Stubs the two things a side panel opened as an ORDINARY TAB gets wrong, so
 * the seeded data is actually visible on it:
 *
 *   1. `chrome.tabs` — the panel asks
 *      `chrome.tabs.query({active: true, currentWindow: true})` and, in a
 *      plain tab, gets back ITS OWN `chrome-extension://…` tab, which
 *      src/infra/chrome-runtime/tab-sync.ts correctly classifies as a
 *      restricted page. Every seeded chat is keyed to the fixture's origin,
 *      so without this the panel opens a fresh empty chat instead.
 *   2. `runtime:get-tools` — the fixture's page tools rather than the empty
 *      list a real extension-origin tab has.
 *
 * MUST be installed before the first navigation: the panel queries
 * `chrome.tabs` during mount. Only ever applied to a panel opened as a tab —
 * the REAL side panel (toolbar icon) and the options page are never stubbed.
 *
 * @param {import("playwright").Page} page
 */
export async function installPanelFixtureStubs(page) {
  await page.addInitScript(
    ({ tab, tools }) => {
      chrome.tabs.query = async () => [tab];
      chrome.tabs.get = async () => tab;
      const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => {
        if (msg && msg.type === "runtime:get-tools") return { tools, available: true };
        return realSend(msg);
      };
    },
    { tab: FIXTURE_TAB, tools: FIXTURE_PAGE_TOOLS },
  );
}
