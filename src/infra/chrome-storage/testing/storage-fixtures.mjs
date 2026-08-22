// @ts-check
// The ONE seeded-storage fixture — shared by the Vitest unit layer and by the
// no-build `verify/` harness (card 86, decisions/30-vitest-test-pyramid.md:
// "its seeded-storage helpers move onto the same typed fixtures the unit
// layer uses, ending the second hand-written copy of the storage schema").
//
// WHY THIS FILE EXISTS. `verify/checks/screenshots.mjs` used to declare its
// own `ChatSession` / `chat:index` / provider records inline: ~250 lines of
// object literals that were a SECOND copy of the storage schema, living
// outside src/, typechecked by nothing. It had already drifted — its
// transcript entries carried no `createdAt` (required on
// `TranscriptEntry` since card 77) and its provider record carried a
// `defaultModel` field `ProviderConfig` has never had. Neither broke a
// screenshot, because `chrome.storage` accepts any JSON and the adapters'
// defensive decoders only check the fields they need. That is precisely the
// silent degradation this file ends: the fixtures below are typed against
// the real domain types, and ./storage-fixtures.test.ts round-trips them
// through the real adapters over the in-memory `chrome.storage` fake, so a
// schema change breaks a TEST instead of quietly degrading a screenshot.
//
// WHY PLAIN `.mjs`. Same reason as ../../webmcp/timeouts.mjs — read that
// file's header. `verify/` is real Node ESM with no build step, so it cannot
// import TypeScript, but it CAN import this file by its literal path.
// tsconfig.app.json has `allowJs` + `checkJs` on, so the JSDoc annotations
// below are real types on the TS side: `npm run check` typechecks this file
// against src/domain exactly as if it were `.ts`.
//
// WHY HERE. src/infra/chrome-storage owns the storage schema — the `chat:`,
// `tabchat:`, `providers:`, `settings:` and `mcp:` keyspaces are declared by
// the adapters in this folder and nowhere else. A fixture for that schema
// belongs next to it, not in a test-support folder at the repo root.
//
// RUNTIME PURITY. No imports at all — every `import(...)` below is inside a
// JSDoc comment and erases to nothing. Nothing here touches `chrome.*`, and
// the returned records are plain JSON, so the harness can hand them straight
// to `chrome.storage.local.set` / `chrome.storage.sync.set` inside a
// `page.evaluate` (where they cross a structured-clone boundary).

/** @typedef {import("../../../domain/chat").ChatSession} ChatSession */
/** @typedef {import("../../../domain/chat").ChatSummary} ChatSummary */
/** @typedef {import("../../../domain/chat").TranscriptEntry} TranscriptEntry */
/** @typedef {import("../../../domain/chat").ToolCallLogEntry} ToolCallLogEntry */
/** @typedef {import("../../../domain/providers").ProviderConfigCore} ProviderConfigCore */
/** @typedef {import("../../../domain/providers").ProviderSelection} ProviderSelection */
/** @typedef {import("../../../domain/providers").ToolCall} ToolCall */
/** @typedef {import("../../../domain/settings").ApprovalPolicy} ApprovalPolicy */
/** @typedef {import("../../../domain/settings").McpApprovalPolicy} McpApprovalPolicy */
/** @typedef {import("../../../domain/tools").McpServerConfigCore} McpServerConfigCore */

// ---------------------------------------------------------------------------
// Storage keys. Mirrored from the adapters in this folder — ../chat-store.ts,
// ../provider-registry.ts, ../settings-store.ts, ../mcp-server-registry.ts —
// which keep them private (they are an adapter's own business). The keys are
// the one thing this file genuinely does restate, and
// ./storage-fixtures.test.ts is what stops the restatement drifting: it never
// reads a key itself, it reads through the adapters, so a renamed key fails
// there rather than here.
// ---------------------------------------------------------------------------

const CHAT_KEY_PREFIX = "chat:";
const CHAT_INDEX_KEY = "chat:index";
const TAB_POINTER_PREFIX = "tabchat:";
const SYNC_KEY_PROVIDERS = "providers:list";
const SYNC_KEY_DEFAULT_SELECTION = "providers:default";
const SYNC_KEY_APPROVAL_POLICY = "settings:approvalPolicy";
const SYNC_KEY_MCP_APPROVAL_POLICY = "settings:mcpApprovalPolicy";
const SYNC_KEY_MCP_SERVERS = "mcp:servers:list";

// ---------------------------------------------------------------------------
// The world the fixture describes
// ---------------------------------------------------------------------------

/** The origin every seeded chat was started against, and the fake tab's own. */
export const FIXTURE_ORIGIN = "https://example.com";

/** The tab id the fixture's `tabchat:` pointer is written for — the harness stubs `chrome.tabs` to report exactly this tab. */
export const FIXTURE_TAB_ID = 1;

/**
 * The active tab the harness stubs `chrome.tabs.query`/`.get` with. Opened as
 * a plain tab, the panel would otherwise ask about ITS OWN
 * `chrome-extension://…` tab and classify every shot as a restricted page.
 * Its `url` is the source of {@link FIXTURE_ORIGIN} — `new URL(url).origin`
 * is how src/infra/chrome-runtime/tab-sync.ts derives a tab's origin, so the
 * two must keep agreeing or the seeded `tabchat:` pointer stops resolving.
 */
export const FIXTURE_TAB = {
  id: FIXTURE_TAB_ID,
  windowId: 1,
  index: 0,
  active: true,
  title: "Example Domain",
  url: `${FIXTURE_ORIGIN}/`,
  favIconUrl: `${FIXTURE_ORIGIN}/favicon.ico`,
};

/**
 * The one configured provider. Deliberately NOT reachable: nothing serves
 * `localhost:11434` during a harness run, so the model sheet captures the
 * picker's unreachable-provider path — the state most worth eyeballing.
 * @type {ProviderConfigCore}
 */
export const FIXTURE_PROVIDER = {
  id: "seed-provider",
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  type: "ollama",
};

/** The model {@link FIXTURE_PROVIDER} is selected with, globally and on every seeded chat. */
export const FIXTURE_MODEL = "qwen3:8b";

/**
 * One registered MCP server, disabled. Disabled on purpose: an ENABLED
 * server would have the options page attempt a real connection during a
 * screenshot run, which is both slow and non-deterministic. Disabled still
 * renders the full row (name, URL, transport, the enable switch).
 * @type {McpServerConfigCore}
 */
export const FIXTURE_MCP_SERVER = {
  id: "seed-mcp-server",
  name: "Docs Server",
  url: "https://mcp.example.com/mcp",
  enabled: false,
  transport: "auto",
};

/**
 * Each chat's first user message — and, since none of them sets an explicit
 * `title`, its `chat:index` preview AND the text the overflow menu's recent
 * row shows, which is how the harness clicks a specific chat by name.
 *
 * SIX of them, and the count matters: five fill the overflow menu's recent
 * list and the sixth is what forces its "More" row to render. This array is
 * the single source of that number — {@link FIXTURE_CHAT_COUNT} and
 * {@link FIXTURE_CHAT_IDS} both derive from it, so adding a prompt cannot
 * leave a chat with an `undefined` message.
 */
export const FIXTURE_CHAT_PROMPTS = [
  "Summarise the pricing table and check the contact form",
  "Which links point off this page?",
  "Find the contact email",
  "Which form fields are required?",
  "List every outbound link",
  "Explain the error banner",
];

/** How many chats the fixture seeds — see {@link FIXTURE_CHAT_PROMPTS}. */
export const FIXTURE_CHAT_COUNT = FIXTURE_CHAT_PROMPTS.length;

/** Every seeded chat's id, newest first — index `i` is `updatedAt = now - i hours`. */
export const FIXTURE_CHAT_IDS = FIXTURE_CHAT_PROMPTS.map((_, i) => `seed-${i}`);

/**
 * The page tools the harness reports for the fake tab, so the composer's tool
 * count and the approval-relevant annotations are real rather than empty.
 * Shape: `SerializedTool` (src/domain/tools).
 * @type {import("../../../domain/tools").SerializedTool[]}
 */
export const FIXTURE_PAGE_TOOLS = [
  {
    name: "read-page-state",
    description: "Read the current state of the page.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "submit-form",
    description: "Submit the contact form.",
    inputSchema: { type: "object", properties: { email: { type: "string" } } },
    annotations: {},
  },
];

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

/**
 * Chat 0's full tool sequence (card 61): every shape the timeline has to
 * render, in one turn — an empty `toolCalls`-only carrier (dropped from
 * DISPLAY by `groupTranscript` while still reading as one continuous
 * activity group with the four calls that follow it), a plain auto/read-only
 * success, an untrusted-content success from a remote MCP server, a denied
 * call, and an error on a hallucinated tool name (origin genuinely unknown —
 * never defaulted to "this page", see ToolCallRow.svelte).
 *
 * Chat 0 therefore has an error AND a denial, which per decisions/26 keeps
 * its activity group EXPANDED by default. That is deliberate: chat 1 below
 * is the all-success contrast that collapses.
 *
 * @param {string} chatId
 * @param {number} at epoch ms for every entry in this turn
 * @returns {TranscriptEntry[]}
 */
function toolSequenceMessages(chatId, at) {
  /** @type {ToolCall[]} */
  const carrierCalls = [
    { id: `${chatId}-call-1`, name: "read-page-state", arguments: {} },
    { id: `${chatId}-call-2`, name: "docs__search", arguments: { query: "pricing" } },
    { id: `${chatId}-call-3`, name: "submit-form", arguments: { email: "test@example.com" } },
    { id: `${chatId}-call-4`, name: "purge-stale-cache", arguments: {} },
  ];
  return [
    { id: `${chatId}-u`, role: "user", content: FIXTURE_CHAT_PROMPTS[0], createdAt: at },
    {
      id: `${chatId}-a1`,
      role: "assistant",
      content: "Let me check a few things on this page first.",
      createdAt: at + 10,
    },
    // The carrier `groupTranscript` drops from display but which must NOT
    // close the open activity group (decisions/26) — without that rule this
    // empty message would split the timeline in two.
    {
      id: `${chatId}-carrier`,
      role: "assistant",
      content: "",
      createdAt: at + 20,
      toolCalls: carrierCalls,
    },
    {
      id: `${chatId}-call-1`,
      role: "tool",
      content: '{"title":"Example Domain","forms":1}',
      createdAt: at + 30,
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
      content:
        "Pricing page last crawled 3 days ago: Starter $9/mo, Team $29/mo, Enterprise — contact us.",
      createdAt: at + 40,
      toolName: "docs__search",
      toolCallId: `${chatId}-call-2`,
      toolArgs: { query: "pricing" },
      toolStatus: "success",
      toolMode: "auto",
      toolAnnotations: { readOnlyHint: true, untrustedContentHint: true },
      toolOrigin: {
        kind: "server",
        serverId: FIXTURE_MCP_SERVER.id,
        serverName: FIXTURE_MCP_SERVER.name,
      },
      toolMcpAnnotations: { title: "search the indexed docs", readOnlyHint: true },
    },
    {
      id: `${chatId}-call-3`,
      role: "tool",
      content: "The user denied this call.",
      createdAt: at + 50,
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
      createdAt: at + 60,
      toolName: "purge-stale-cache",
      toolCallId: `${chatId}-call-4`,
      toolArgs: {},
      toolStatus: "error",
      toolMode: "auto",
      // Deliberately no `toolOrigin` — a hallucinated tool name genuinely
      // wasn't in this turn's merged list, so origin is unknown.
    },
    {
      id: `${chatId}-a2`,
      role: "assistant",
      createdAt: at + 70,
      content:
        "Here's what I found:\n\n" +
        "- Pricing: Starter $9/mo, Team $29/mo, Enterprise is contact-only\n" +
        "- The contact form submission was denied, so it wasn't sent\n" +
        "- One tool call failed (`purge-stale-cache` isn't a real tool on this page)",
    },
  ];
}

/**
 * Chat 0's tool-call log — the `Inspector`/call-log view of the same turn.
 * @param {string} chatId
 * @param {number} at
 * @returns {ToolCallLogEntry[]}
 */
function toolSequenceLog(chatId, at) {
  return [
    {
      id: `${chatId}-call-1`,
      name: "read-page-state",
      arguments: {},
      mode: "auto",
      origin: { kind: "page" },
      result: { title: "Example Domain", forms: 1 },
      startedAt: at,
      endedAt: at + 180,
    },
    {
      id: `${chatId}-call-2`,
      name: "docs__search",
      arguments: { query: "pricing" },
      mode: "auto",
      origin: {
        kind: "server",
        serverId: FIXTURE_MCP_SERVER.id,
        serverName: FIXTURE_MCP_SERVER.name,
      },
      result: "Pricing page last crawled 3 days ago...",
      startedAt: at + 200,
      endedAt: at + 1400,
    },
    {
      id: `${chatId}-call-3`,
      name: "submit-form",
      arguments: { email: "test@example.com" },
      mode: "denied",
      origin: { kind: "page" },
      error: "The user denied this call.",
      startedAt: at + 1500,
      endedAt: at + 1500,
    },
    {
      id: `${chatId}-call-4`,
      name: "purge-stale-cache",
      arguments: {},
      mode: "auto",
      error: "Tool not found in the current page's tool list.",
      startedAt: at + 1600,
      endedAt: at + 1720,
    },
  ];
}

/**
 * Chat 1's clean run: every call succeeds, so this is what the COLLAPSED
 * default (decisions/26) actually looks like — the contrast chat 0's
 * permanently-expanded group needs a second shot to show.
 * @param {string} chatId
 * @param {number} at
 * @returns {TranscriptEntry[]}
 */
function cleanRunMessages(chatId, at) {
  /** @type {ToolCall[]} */
  const carrierCalls = [
    { id: `${chatId}-call-1`, name: "read-page-state", arguments: {} },
    { id: `${chatId}-call-2`, name: "list-links", arguments: {} },
  ];
  return [
    { id: `${chatId}-u`, role: "user", content: FIXTURE_CHAT_PROMPTS[1], createdAt: at },
    {
      id: `${chatId}-a1`,
      role: "assistant",
      content: "One moment, checking the page.",
      createdAt: at + 10,
    },
    {
      id: `${chatId}-carrier`,
      role: "assistant",
      content: "",
      createdAt: at + 20,
      toolCalls: carrierCalls,
    },
    {
      id: `${chatId}-call-1`,
      role: "tool",
      content: '{"title":"Example Domain"}',
      createdAt: at + 30,
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
      createdAt: at + 40,
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
      createdAt: at + 50,
    },
  ];
}

/**
 * Chat 1's tool-call log.
 * @param {string} chatId
 * @param {number} at
 * @returns {ToolCallLogEntry[]}
 */
function cleanRunLog(chatId, at) {
  return [
    {
      id: `${chatId}-call-1`,
      name: "read-page-state",
      arguments: {},
      mode: "auto",
      origin: { kind: "page" },
      result: { title: "Example Domain" },
      startedAt: at,
      endedAt: at + 140,
    },
    {
      id: `${chatId}-call-2`,
      name: "list-links",
      arguments: {},
      mode: "auto",
      origin: { kind: "page" },
      result: ["https://iana.org"],
      startedAt: at + 160,
      endedAt: at + 260,
    },
  ];
}

// ---------------------------------------------------------------------------
// The fixture itself
// ---------------------------------------------------------------------------

/** How far apart consecutive seeded chats sit, so the history list has a spread of "x hours ago" stamps rather than six identical ones. */
const CHAT_SPACING_MS = 3_600_000;

/**
 * The seeded chats, newest first (index 0 is the most recently updated, and
 * is the chat {@link FIXTURE_TAB_ID}'s pointer targets).
 *
 * `selection` + `selectionExplicit` together are card 35's "the user actually
 * chose this" flag: without the explicit flag the composer sits in its
 * needs-confirmation state and that is all any screenshot would ever show.
 *
 * @param {number} now epoch ms the newest chat is stamped with
 * @returns {ChatSession[]}
 */
export function buildFixtureChats(now) {
  return FIXTURE_CHAT_IDS.map((id, i) => {
    const at = now - i * CHAT_SPACING_MS;
    const messages =
      i === 0
        ? toolSequenceMessages(id, at)
        : i === 1
          ? cleanRunMessages(id, at)
          : [
              /** @type {TranscriptEntry} */ ({
                id: `${id}-u`,
                role: "user",
                content: FIXTURE_CHAT_PROMPTS[i],
                createdAt: at,
              }),
            ];
    const toolCalls = i === 0 ? toolSequenceLog(id, at) : i === 1 ? cleanRunLog(id, at) : [];
    return {
      id,
      origin: FIXTURE_ORIGIN,
      messages,
      toolCalls,
      createdAt: at,
      updatedAt: at,
      selection: { providerId: FIXTURE_PROVIDER.id, model: FIXTURE_MODEL },
      selectionExplicit: true,
    };
  });
}

/**
 * The `chat:index` entry for one chat.
 *
 * A hand-written mirror of `summarizeChat` (src/domain/chat) — this file
 * cannot import it, since a `.mjs` consumed by no-build Node cannot pull in
 * TypeScript. ./storage-fixtures.test.ts asserts the two agree entry for
 * entry, so the mirror cannot drift silently; that assertion is the whole
 * reason this function is allowed to exist.
 *
 * @param {ChatSession} chat
 * @returns {ChatSummary}
 */
export function summarizeFixtureChat(chat) {
  const firstUser = chat.messages.find((m) => m.role === "user");
  const trimmed = firstUser?.content.trim();
  // Mirrors `chatPreview`'s cap (`MAX_CHAT_PREVIEW_LENGTH` = 120) including
  // its ellipsis, so a future fixture prompt longer than the cap does not
  // quietly make the two derivations disagree.
  const preview = !trimmed
    ? undefined
    : trimmed.length > 120
      ? `${trimmed.slice(0, 120)}…`
      : trimmed;
  return {
    id: chat.id,
    origin: chat.origin,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
    toolCallCount: chat.toolCalls.length,
    preview,
    title: chat.title,
  };
}

/**
 * Key prefixes in `chrome.storage.local` the fixture OWNS — a consumer
 * seeding a live profile clears these before writing, so the seeded world is
 * exactly the fixture and nothing else.
 *
 * This matters for the screenshot harness specifically: `verify/run.mjs`
 * opens the side panel as an ordinary tab several checks before the
 * screenshots run, and a panel mounted against its own `chrome-extension://`
 * tab legitimately creates and persists an empty chat for it. Two such
 * strays used to show up in the options page's chat-history list, where a
 * reviewer eyeballing the shot has no way to tell a harness artefact from a
 * real bug.
 */
export const FIXTURE_LOCAL_KEY_PREFIXES = [CHAT_KEY_PREFIX, TAB_POINTER_PREFIX];

/**
 * Everything the fixture writes to `chrome.storage.local`: one record per
 * chat, the `chat:index` list, and the fake tab's pointer at the newest chat.
 *
 * @param {{now?: number, tabId?: number}} [options]
 * @returns {Record<string, unknown>}
 */
export function buildLocalSeed({ now = Date.now(), tabId = FIXTURE_TAB_ID } = {}) {
  const chats = buildFixtureChats(now);
  /** @type {Record<string, unknown>} */
  const seed = {};
  for (const chat of chats) seed[`${CHAT_KEY_PREFIX}${chat.id}`] = chat;
  seed[CHAT_INDEX_KEY] = chats.map(summarizeFixtureChat);
  seed[`${TAB_POINTER_PREFIX}${tabId}`] = {
    chatId: chats[0].id,
    tabOrigin: FIXTURE_ORIGIN,
  };
  return seed;
}

/**
 * Everything the fixture writes to `chrome.storage.sync`: the provider list
 * and default selection (decisions/10 — providers are preferences, so they
 * sync; their credentials never do, and this fixture has none), both
 * approval policies at their documented defaults, and one MCP server.
 *
 * @returns {Record<string, unknown>}
 */
export function buildSyncSeed() {
  /** @type {ProviderSelection} */
  const defaultSelection = { providerId: FIXTURE_PROVIDER.id, model: FIXTURE_MODEL };
  /** @type {ApprovalPolicy} */
  const approvalPolicy = "default";
  /** @type {McpApprovalPolicy} */
  const mcpApprovalPolicy = "always-confirm";
  return {
    [SYNC_KEY_PROVIDERS]: [FIXTURE_PROVIDER],
    [SYNC_KEY_DEFAULT_SELECTION]: defaultSelection,
    [SYNC_KEY_APPROVAL_POLICY]: approvalPolicy,
    [SYNC_KEY_MCP_APPROVAL_POLICY]: mcpApprovalPolicy,
    [SYNC_KEY_MCP_SERVERS]: [FIXTURE_MCP_SERVER],
  };
}

/**
 * Both areas at once — what a caller seeding a whole browser profile wants.
 * @param {{now?: number, tabId?: number}} [options]
 * @returns {{local: Record<string, unknown>, sync: Record<string, unknown>}}
 */
export function buildStorageFixture(options = {}) {
  return { local: buildLocalSeed(options), sync: buildSyncSeed() };
}
