// Shared helpers for every LIVE scenario — anything that needs a real,
// locally-running Ollama with a tool-capable model rather than a mock model
// gateway (this harness has none, by design: verify/ drives the real
// chrome.* surface and the real Svelte UI, never a fake provider).
//
// Extracted from verify/checks/liveSmoke.mjs (card 90) by card 112, which
// adds three more scripts needing exactly this same "find a model, seed one
// provider, confirm the picker" preamble: verify/checks/approvalScenario.mjs
// and verify/checks/turnControlScenario.mjs. liveSmoke.mjs itself now imports
// from here too, so there is exactly one copy of each of these three things.
//
// Every caller keeps liveSmoke's own posture: if no local Ollama with a
// tool-capable model is reachable, that is "blocked on environment", not a
// failure — each script checks {@link pickToolCapableModel}'s result itself
// and exits 0 rather than treating an unset dev machine as broken.

import { sidepanelUrl } from "./browser.mjs";

export const OLLAMA_ORIGIN = "http://localhost:11434";

/** Picks the first model Ollama reports with `"tools"` in its capabilities — the same signal src/infra/ollama/client.ts's `getCapabilities` (POST /api/show) uses, read here off the cheaper /api/tags listing instead. */
export async function pickToolCapableModel() {
  let res;
  try {
    res = await fetch(`${OLLAMA_ORIGIN}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.json();
  const models = Array.isArray(body?.models) ? body.models : [];
  const withTools = models.find(
    (m) => Array.isArray(m.capabilities) && m.capabilities.includes("tools"),
  );
  return withTools ? (withTools.model ?? withTools.name) : null;
}

/**
 * Writes the one seeded provider straight into `chrome.storage.sync` from an
 * extension-origin page — the WRITE half of the "navigate once, write,
 * reload into the seeded world" two-step verify/checks/screenshots.mjs uses,
 * since storage writes are async and must complete before the app's first
 * mount reads them. No MCP servers, no chat history: a genuinely fresh
 * install pointed at one real provider.
 *
 * Deliberately split from {@link reloadIntoSeededWorld} rather than one
 * function doing both navigations back to back — see that function's own
 * comment for why the SECOND navigation has to happen only after every
 * other tab this run will use already exists.
 *
 * @param {import("playwright").Page} page
 * @param {string} extensionId
 * @param {{providerId: string, providerName: string, model: string, approvalPolicy?: string}} options
 *   `approvalPolicy` defaults to `"default"` — decisions/05's
 *   readOnlyHint-gated policy, the one that makes an unannotated demo tool
 *   like `add-note` require a human decision. A caller that genuinely wants
 *   every call auto-approved (none, today) could override it.
 */
export async function writeLiveProviderStorage(
  page,
  extensionId,
  { providerId, providerName, model, approvalPolicy = "default" },
) {
  await page.goto(sidepanelUrl(extensionId));
  await page.evaluate(
    async ({ provider, selection, policy }) => {
      await chrome.storage.sync.set({
        "providers:list": [provider],
        "providers:default": selection,
        "settings:approvalPolicy": policy,
        "settings:mcpApprovalPolicy": "trust-read-only",
      });
    },
    {
      provider: { id: providerId, name: providerName, baseUrl: OLLAMA_ORIGIN, type: "ollama" },
      selection: { providerId, model },
      policy: approvalPolicy,
    },
  );
}

/**
 * Reloads the panel to pick up whatever {@link writeLiveProviderStorage} (or
 * verify/lib/seed.mjs's `seedExtensionStorage`) just wrote — the RELOAD half
 * of the seeding two-step.
 *
 * MUST be called only after every other tab this run needs (the demo page,
 * chiefly) has already been opened. Card 112 found — reproduced in
 * isolation, with NO storage write involved at all, a bare
 * `panel.goto()` twice — that reloading the panel's OWN tab and only THEN
 * opening a second tab makes src/infra/chrome-runtime/tab-sync.ts
 * mis-track the newly active tab as restricted, seemingly permanently (a
 * demo-tab reload, or even closing and reopening it as a brand new tab, did
 * not recover it in repeated trials). Reversing the order — open every
 * other tab FIRST, reload the panel LAST — reproduced clean 12/12 in the
 * same repro. This is a real, pre-existing race in the tab-tracking
 * machinery (also affects the unmodified verify/checks/liveSmoke.mjs before
 * this fix), not something particular to any one scenario; the safe order
 * is now load-bearing here so every caller gets it for free. Worth its own
 * follow-up card to fix at the source — out of scope for this one.
 *
 * @param {import("playwright").Page} page
 * @param {string} extensionId
 */
export async function reloadIntoSeededWorld(page, extensionId) {
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForLoadState("domcontentloaded");
}

/**
 * Confirms the seeded default selection through the REAL model picker —
 * card 35: a freshly-seeded default selection starts unconfirmed
 * (`needsConfirmation`) until a real click through the picker marks it
 * explicit, and the composer stays blocked until then. Drives the actual UI,
 * not a storage shortcut, so every live scenario proves this gate too.
 *
 * @param {import("playwright").Page} panel
 * @param {string} model
 */
export async function confirmModelSelection(panel, model) {
  const trigger = panel.locator(".picker__trigger");
  await trigger.waitFor({ state: "visible", timeout: 15000 });
  await trigger.click();
  // Scoped to the popover's own [aria-label="Choose a model"] content, not
  // the whole page — the trigger chip ITSELF already shows text matching
  // `model`, so an unscoped text search could re-click the trigger instead of
  // a row inside the open popover.
  const popover = panel.locator('[aria-label="Choose a model"]');
  await popover.waitFor({ state: "visible", timeout: 20000 });
  const modelOption = popover.getByText(model, { exact: false }).first();
  await modelOption.waitFor({ state: "visible", timeout: 20000 });
  await modelOption.click();
  const textarea = panel.getByRole("textbox", { name: "Message" });
  await textarea.waitFor({ state: "visible", timeout: 10000 });
}
