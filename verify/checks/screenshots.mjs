// Screenshots the side panel page (opened as a plain tab, since MV3 side
// panel UI cannot be opened programmatically) across the light/dark x
// 320/400px matrix, plus its two anchored surfaces (the overflow menu and
// the model sheet), for a human to eyeball.
//
// BEST EFFORT: a broken render here is an expected possibility, not a
// harness bug — verify/run.mjs treats a throw from this file as
// non-fatal (reported SKIP, not FAIL).
//
// "Non-fatal" is not the same as "silent". Card 72 made every locator this
// file depends on a hard requirement (`requireLocator`) and asserts the full
// `EXPECTED_SHOTS` matrix before returning, so a drifted accessible name or
// hook class downgrades the check to SKIP *with the missing shot named*
// instead of quietly writing eight files and reporting PASS.
//
// Two pieces of stubbing are what make the shots worth looking at at all:
//
//   1. `chrome.tabs` is stubbed. Opened as a plain tab, the panel asks
//      `chrome.tabs.query({active: true, currentWindow: true})` and gets
//      back ITS OWN tab, whose URL is `chrome-extension://…` — which
//      src/sidepanel/services/activeTab.ts correctly classifies as a
//      restricted page. Without the stub, every screenshot shows the
//      restricted state and nothing else.
//   2. `chrome.storage.local` is seeded with real `ChatSession` /
//      `chat:index` records (the shapes in src/lib/session.ts) so the
//      transcript has messages in it and the overflow menu has more than
//      five chats to list — i.e. so "Recent chats" and its "More" row are
//      both exercised.
//   3. `chrome.storage.sync` is seeded with one provider, and the seeded
//      session carries a resolved `selection` with `selectionExplicit`, so
//      the composer is UNBLOCKED and its model chip renders. Without that,
//      card 35's blocked state is all these shots would ever show. The
//      provider itself is not reachable, so the model sheet screenshot
//      captures the picker's unreachable-provider path — which is the state
//      most worth eyeballing anyway.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { sidepanelUrl } from "../lib/browser.mjs";

const FAKE_TAB = {
  id: 1,
  windowId: 1,
  index: 0,
  active: true,
  title: "Example Domain",
  url: "https://example.com/",
  favIconUrl: "https://example.com/favicon.ico",
};

/** Six chats: five fill the menu's recent list, the sixth forces the "More" row. */
const SEEDED_CHAT_COUNT = 6;

const SEEDED_PROVIDER = {
  id: "seed-provider",
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  type: "ollama",
  defaultModel: "qwen3:8b",
};

/**
 * Chat 0's full tool sequence (card 61): every shape the new timeline has to
 * render in one turn — an empty toolCalls-only carrier (must be dropped from
 * DISPLAY by `groupTranscript` while still reading as one continuous
 * activity group with the four calls that follow it), a plain auto/
 * read-only success, an untrusted-content success from a remote MCP server
 * (so the group's collapsed summary would also need a `via <server>`
 * clause — moot here since errors/denials keep this group expanded by
 * design, but worth having in the payload view regardless), a denied call,
 * and an error on a hallucinated tool name (origin genuinely unknown, never
 * defaulted to "this page" — see ToolCallRow.svelte).
 */
function buildToolSequenceMessages(chatId, baseTime) {
  const carrierCalls = [
    { id: `${chatId}-call-1`, name: "read-page-state", arguments: {} },
    { id: `${chatId}-call-2`, name: "docs__search", arguments: { query: "pricing" } },
    { id: `${chatId}-call-3`, name: "submit-form", arguments: { email: "test@example.com" } },
    { id: `${chatId}-call-4`, name: "purge-stale-cache", arguments: {} },
  ];
  return [
    { id: `${chatId}-u`, role: "user", content: "Summarise the pricing table and check the contact form" },
    {
      id: `${chatId}-a1`,
      role: "assistant",
      content: "Let me check a few things on this page first.",
    },
    // The toolCalls-only carrier `groupTranscript` drops from display but
    // must NOT close the open activity group (decisions/26) — without that
    // rule this empty message would split the timeline in two.
    { id: `${chatId}-carrier`, role: "assistant", content: "", toolCalls: carrierCalls },
    {
      id: `${chatId}-call-1`,
      role: "tool",
      content: '{"title":"Example Domain","forms":1}',
      toolName: "read-page-state",
      toolCallId: `${chatId}-call-1`,
      toolArgs: {},
      toolStatus: "success",
      toolMode: "auto",
      toolAnnotations: { readOnlyHint: true },
      toolOrigin: { kind: "page" },
    },
    {
      id: `${chatId}-call-2`,
      role: "tool",
      content: "Pricing page last crawled 3 days ago: Starter $9/mo, Team $29/mo, Enterprise — contact us.",
      toolName: "docs__search",
      toolCallId: `${chatId}-call-2`,
      toolArgs: { query: "pricing" },
      toolStatus: "success",
      toolMode: "auto",
      toolAnnotations: { readOnlyHint: true, untrustedContentHint: true },
      toolOrigin: { kind: "server", serverId: "docs-server", serverName: "Docs Server" },
      toolMcpAnnotations: { title: "search the indexed docs", readOnlyHint: true },
    },
    {
      id: `${chatId}-call-3`,
      role: "tool",
      content: "The user denied this call.",
      toolName: "submit-form",
      toolCallId: `${chatId}-call-3`,
      toolArgs: { email: "test@example.com" },
      toolStatus: "denied",
      toolMode: "denied",
      toolOrigin: { kind: "page" },
    },
    {
      id: `${chatId}-call-4`,
      role: "tool",
      content: "Error: tool not found in the current page's tool list.",
      toolName: "purge-stale-cache",
      toolCallId: `${chatId}-call-4`,
      toolArgs: {},
      toolStatus: "error",
      toolMode: "auto",
      // Deliberately no `toolOrigin` — a hallucinated tool name genuinely
      // wasn't in this turn's merged list, so origin is unknown, never
      // defaulted to "this page" (see ToolCallRow.svelte).
    },
    {
      id: `${chatId}-a2`,
      role: "assistant",
      content:
        "Here's what I found:\n\n" +
        "- Pricing: Starter $9/mo, Team $29/mo, Enterprise is contact-only\n" +
        "- The contact form submission was denied, so it wasn't sent\n" +
        "- One tool call failed (`purge-stale-cache` isn't a real tool on this page)",
    },
  ];
}

function buildToolSequenceLog(chatId, baseTime) {
  return [
    {
      id: `${chatId}-call-1`,
      name: "read-page-state",
      arguments: {},
      mode: "auto",
      origin: { kind: "page" },
      result: { title: "Example Domain", forms: 1 },
      startedAt: baseTime,
      endedAt: baseTime + 180,
    },
    {
      id: `${chatId}-call-2`,
      name: "docs__search",
      arguments: { query: "pricing" },
      mode: "auto",
      origin: { kind: "server", serverId: "docs-server", serverName: "Docs Server" },
      result: "Pricing page last crawled 3 days ago...",
      startedAt: baseTime + 200,
      endedAt: baseTime + 1400,
    },
    {
      id: `${chatId}-call-3`,
      name: "submit-form",
      arguments: { email: "test@example.com" },
      mode: "denied",
      origin: { kind: "page" },
      error: "The user denied this call.",
      startedAt: baseTime + 1500,
      endedAt: baseTime + 1500,
    },
    {
      id: `${chatId}-call-4`,
      name: "purge-stale-cache",
      arguments: {},
      mode: "auto",
      error: "Tool not found in the current page's tool list.",
      startedAt: baseTime + 1600,
      endedAt: baseTime + 1720,
    },
  ];
}

/** Chat 1's clean run: every call succeeds, so this is what the COLLAPSED default (decisions/26) actually looks like — chat 0 above has an error and a denial and stays expanded by design, which is exactly the contrast a reviewer needs both shots for. */
function buildCleanRunMessages(chatId) {
  const carrierCalls = [
    { id: `${chatId}-call-1`, name: "read-page-state", arguments: {} },
    { id: `${chatId}-call-2`, name: "list-links", arguments: {} },
  ];
  return [
    { id: `${chatId}-u`, role: "user", content: "Which links point off this page?" },
    { id: `${chatId}-a1`, role: "assistant", content: "One moment, checking the page." },
    { id: `${chatId}-carrier`, role: "assistant", content: "", toolCalls: carrierCalls },
    {
      id: `${chatId}-call-1`,
      role: "tool",
      content: '{"title":"Example Domain"}',
      toolName: "read-page-state",
      toolCallId: `${chatId}-call-1`,
      toolArgs: {},
      toolStatus: "success",
      toolMode: "auto",
      toolAnnotations: { readOnlyHint: true },
      toolOrigin: { kind: "page" },
    },
    {
      id: `${chatId}-call-2`,
      role: "tool",
      content: '["https://iana.org"]',
      toolName: "list-links",
      toolCallId: `${chatId}-call-2`,
      toolArgs: {},
      toolStatus: "success",
      toolMode: "auto",
      toolAnnotations: { readOnlyHint: true },
      toolOrigin: { kind: "page" },
    },
    {
      id: `${chatId}-a2`,
      role: "assistant",
      content: "Found one outbound link: `iana.org`.",
    },
  ];
}

function buildCleanRunLog(chatId, baseTime) {
  return [
    {
      id: `${chatId}-call-1`,
      name: "read-page-state",
      arguments: {},
      mode: "auto",
      origin: { kind: "page" },
      result: { title: "Example Domain" },
      startedAt: baseTime,
      endedAt: baseTime + 140,
    },
    {
      id: `${chatId}-call-2`,
      name: "list-links",
      arguments: {},
      mode: "auto",
      origin: { kind: "page" },
      result: ["https://iana.org"],
      startedAt: baseTime + 160,
      endedAt: baseTime + 260,
    },
  ];
}

function seedData() {
  const now = Date.now();
  const prompts = [
    "Summarise the pricing table and check the contact form",
    "Which links point off this page?",
    "Find the contact email",
    "Which form fields are required?",
    "List every outbound link",
    "Explain the error banner",
  ];
  const index = [];
  const chats = {};
  for (let i = 0; i < SEEDED_CHAT_COUNT; i++) {
    const id = `seed-${i}`;
    const updatedAt = now - i * 3600_000;
    let messages;
    let toolCalls = [];
    if (i === 0) {
      messages = buildToolSequenceMessages(id, updatedAt);
      toolCalls = buildToolSequenceLog(id, updatedAt);
    } else if (i === 1) {
      messages = buildCleanRunMessages(id);
      toolCalls = buildCleanRunLog(id, updatedAt);
    } else {
      messages = [{ id: `${id}-u`, role: "user", content: prompts[i] }];
    }
    chats[`chat:${id}`] = {
      id,
      origin: "https://example.com",
      messages,
      toolCalls,
      createdAt: updatedAt,
      updatedAt,
      selection: { providerId: SEEDED_PROVIDER.id, model: SEEDED_PROVIDER.defaultModel },
      // Card 35's "the user actually chose this" flag — without it the
      // composer sits in its needs-confirmation state instead.
      selectionExplicit: true,
    };
    index.push({
      id,
      origin: "https://example.com",
      createdAt: updatedAt,
      updatedAt,
      messageCount: messages.length,
      toolCallCount: toolCalls.length,
      preview: prompts[i],
    });
  }
  return { ...chats, "chat:index": index, "tabchat:1": { chatId: "seed-0", tabOrigin: "https://example.com" } };
}

async function shoot(page, outDir, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/**
 * Every capture this check is supposed to produce. Card 72: the anchored and
 * activity shots used to hang off `if (await locator.count())` guards, so a
 * drifted accessible name or hook class silently produced a SHORTER file list
 * and the check still reported PASS — exactly the silent degradation
 * decisions/28 warns migration cards about. The matrix below is asserted
 * after the run instead, so a missing capture is a loud SKIP naming the shot
 * that vanished.
 */
const EXPECTED_SHOTS = [
  "sidepanel-light-320w",
  "sidepanel-dark-320w",
  "sidepanel-light-400w",
  "sidepanel-dark-400w",
  "sidepanel-dark-menu",
  "sidepanel-dark-model-sheet",
  "sidepanel-dark-activity-expanded",
  "sidepanel-dark-activity-payload",
  "sidepanel-dark-activity-collapsed",
];

/**
 * Waits for a locator the matrix depends on, turning "it isn't there" into a
 * message that names the selector and what it was for — a drifted hook class
 * or accessible name is then one line of report output, not a mystery.
 */
async function requireLocator(locator, what) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw new Error(`Screenshot matrix incomplete: could not find ${what} (${locator}) — selector drifted?`);
  }
  return locator.first();
}

export async function screenshotSidepanel(context, extensionId, outDir) {
  mkdirSync(outDir, { recursive: true });
  const page = await context.newPage();

  // Must be installed BEFORE the first navigation: activeTab.ts queries
  // chrome.tabs during mount.
  await page.addInitScript(
    ({ tab }) => {
      chrome.tabs.query = async () => [tab];
      chrome.tabs.get = async () => tab;
      const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => {
        if (msg && msg.type === "runtime:get-tools") {
          return {
            tools: [
              {
                name: "read-page-state",
                description: "Read the current state of the page.",
                inputSchema: { type: "object", properties: {} },
              },
              {
                name: "submit-form",
                description: "Submit the contact form.",
                inputSchema: { type: "object", properties: { email: { type: "string" } } },
                annotations: { destructiveHint: true },
              },
            ],
            available: true,
          };
        }
        return realSend(msg);
      };
    },
    { tab: FAKE_TAB },
  );

  // Seeding has to complete BEFORE the app mounts and reads storage, and
  // chrome.storage writes are async — doing it inside the init script races
  // the stores' initial load and loses. So: navigate once to get an
  // extension-origin context, write, then reload into a seeded world.
  await page.goto(sidepanelUrl(extensionId));
  await page.evaluate(
    async ({ seed, provider }) => {
      await chrome.storage.local.set(seed);
      // Providers live in storage.sync (src/lib/providers/registry.ts), not local.
      await chrome.storage.sync.set({
        "providers:list": [provider],
        "providers:default": { providerId: provider.id, model: provider.defaultModel },
      });
    },
    { seed: seedData(), provider: SEEDED_PROVIDER },
  );

  const files = [];
  for (const width of [320, 400]) {
    for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ colorScheme });
      await page.goto(sidepanelUrl(extensionId));
      await page.waitForLoadState("domcontentloaded");
      // Give the Svelte app a moment to mount (or fail trying to) and the
      // seeded session a moment to load before capturing.
      await page.waitForTimeout(900);
      files.push(await shoot(page, outDir, `sidepanel-${colorScheme}-${width}w`));
    }
  }

  // The two anchored surfaces, which are the hardest things to eyeball
  // any other way: both are dismissed by a click anywhere outside them, so
  // they never appear in an ordinary screenshot.
  await page.setViewportSize({ width: 400, height: 720 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForTimeout(900);

  const menuButton = await requireLocator(
    page.getByRole("button", { name: "More options" }),
    "the header's overflow-menu button",
  );
  await menuButton.click();
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-menu"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // `.picker__trigger` is a styling-free hook class kept on the composer's
  // model chip purely for this locator (ProviderPicker.svelte:346) — the
  // chip's own accessible name is the model id, which moves with seed data.
  const modelChip = await requireLocator(page.locator(".picker__trigger"), "the composer's model-picker trigger");
  await modelChip.click();
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-model-sheet"));
  // Dismiss before the activity shots below — left open, the sheet would
  // sit on top of every one of them.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // Card 61: the activity timeline. Chat 0 (seed-0, still the current tab's
  // chat at this point — `tabchat:1` points at it, and nothing above has
  // navigated away) has an error AND a denied call, so its group is
  // expanded by default (decisions/26: a group that needs attention never
  // auto-collapses) — no click needed for the "expanded" shot.
  //
  // `.activity-group .summary` and `.step .row-head` are, like
  // `.picker__trigger`, styling-free hook classes kept on
  // ActivityGroup.svelte / ToolCallRow.svelte for these two locators.
  await requireLocator(page.locator(".activity-group .summary"), "an activity group's summary row");
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-activity-expanded"));

  const firstRow = await requireLocator(page.locator(".step .row-head"), "a tool-call step's header row");
  await firstRow.click();
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-activity-payload"));

  // Chat 1 (seed-1) is a clean all-success run, so its group is COLLAPSED
  // by default — the contrast decisions/26 is built around, and otherwise
  // never captured by any shot above. Reached via the overflow menu's
  // recent-chats list rather than a direct storage-pointer rewrite, so this
  // exercises the same navigation path a user actually takes. A fresh
  // reload first (rather than continuing on the page left mid-interaction
  // by the payload-expand click above) resets scroll/expansion state so the
  // menu's "More options" button is exactly where every other shot in this
  // file finds it.
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);
  const menuButtonAgain = await requireLocator(
    page.getByRole("button", { name: "More options" }),
    "the header's overflow-menu button (second open)",
  );
  await menuButtonAgain.click();
  await page.waitForTimeout(250);
  // "Which links point off this page?" (seed-1's own first user message,
  // via titleFromSummary) rather than a fixed index: the menu's first
  // `role="menuitem"` is a connection-status row above "Recent chats",
  // so an index would be one off from what it looks like it should be —
  // matching by the chat's own title is what it actually says on screen.
  const chatOneRow = await requireLocator(
    page.getByRole("menuitem", { name: "Which links point off this page?" }),
    "seed-1's row in the menu's recent-chats list",
  );
  await chatOneRow.click();
  await page.waitForTimeout(400);
  files.push(await shoot(page, outDir, "sidepanel-dark-activity-collapsed"));

  await page.close();

  const captured = new Set(files.map((f) => path.basename(f, ".png")));
  const missing = EXPECTED_SHOTS.filter((name) => !captured.has(name));
  if (missing.length > 0) {
    throw new Error(`Screenshot matrix incomplete: missing ${missing.join(", ")}`);
  }
  return { count: files.length, files };
}
