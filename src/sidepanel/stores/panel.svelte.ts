// Panel state for the side panel chat shell (card 07), now backed by
// card 34's global, tab-aware chat history (src/lib/session.ts,
// decisions/13-global-tab-aware-chat-history.md, which REVISES
// decisions/07-session-state-and-persistence.md) — the SESSION SWAP
// documented in card 07's original header comment, generalised from "swap
// to this tab's session" to "swap to whichever chat is current".
//
// IDENTITY (decision 13): a chat is no longer a property of a tab. Each
// `ChatSession` has its own `id` and is listed globally; a tab merely
// POINTS at its current chat id (persisted via src/lib/session.ts's
// `tabchat:<tabId>` pointer). This module tracks which tab it's currently
// showing in two plain module vars, `activeTabId`/`activeTabOrigin` — NOT
// on the `ChatSession` itself, since the same chat can legitimately be
// viewed from a tab whose origin differs from the chat's own `origin`
// (decision 13's cross-origin-open case). `activeTabOrigin` is the tab's
// REAL current origin, kept in step by `syncSessionToTab`/
// `applyPanelNavigation` only — opening a past chat via `openChatInTab`
// does NOT touch it, so a later actual navigation is still detected
// correctly regardless of which chat happens to be open at the time.
//
// `messages` is a VIEW over the active chat's `ChatSession.messages`: every
// entry this module pushes is a `PanelMessage`, which structurally *is* a
// `ChatMessage` (role/content/toolCalls/toolCallId/toolName) plus small
// UI-only extras (`id`, `createdAt`, `toolArgs`, `toolStatus`). Because
// `ChatSession.messages` is typed `ChatMessage[]`, storing these richer
// objects in it works by ordinary structural subtyping — reading them back
// out (via the `messages` getter below) reclaims the extra fields with one
// cast, and since `src/lib/session.ts` persists whatever JSON shape it's
// given, those extra fields round-trip through `chrome.storage.local`
// untouched. The agent loop (src/sidepanel/services/agentLoop.ts) reads
// `panel.messages` directly as the conversation history to send a provider,
// relying on exactly this: a `PanelMessage[]` is a valid `ChatMessage[]`.
//
// Every mutator that changes the transcript also persists it:
//   - `addUserMessage`, `beginAssistantMessage`, `endAssistantMessage`,
//     `addToolCall`, `updateToolCallResult` write immediately
//     (`saveSession(session, {immediate: true})`) — none of these happen
//     token-by-token, so there is no debounce reason to delay them.
//   - `appendAssistantDelta` (the token-by-token one) calls the plain,
//     debounced `saveSession(session)` — see src/lib/session.ts's own
//     DEBOUNCE_MS/MAX_WAIT_MS tuning. No per-token writes happen here.
//   - `addToolCall`/`updateToolCallResult` additionally route through
//     `logToolCall`/`completeToolCall` so `session.toolCalls` (card 11's
//     inspector log) gets populated too, not just the transcript's display
//     copy — the transcript copy and the log are two different views of the
//     same call, kept in step by these two mutators.
//
// `syncSessionToTab` (real tab switch: resolve that tab's pointer) and
// `applyPanelNavigation` (same-tab cross-origin nav: RETIRE the current
// chat — leave it exactly as-is in storage, just stop pointing this tab at
// it — and start a fresh one) are the swap's entry points; see
// src/sidepanel/services/activeTab.ts, which distinguishes the two per
// decision 13's "cross-origin navigation no longer destroys a conversation
// ... it starts a new current chat and leaves the old one in history."
// Both funnel through `startNewChat`, exported as the SEAM card 36 ("New
// Chat" button) needs — see its doc comment below.
//
// `openChatInTab` is the third entry point: resuming a chat from the
// History view (card 34), including one started against a different origin
// than the current tab — allowed, but the UI must stay honest about it
// (decision 13): `activeChatOrigin` is exposed below precisely so a
// consumer (App.svelte) can compare it against `pageInfo.origin` and show
// that this page's tools are not the ones the transcript used, rather than
// implying old tool calls could be re-run here. Page tools themselves
// always come from `pageInfo`/`tools` (the CURRENT tab), never from
// anything chat-specific — that separation already existed and needs no
// change here.
//
// `streamingMessageId`, `connectionStatus`, `pageInfo`, and the stop-handler
// seam stay in-memory/ephemeral — they were never part of the swap.
//
// SINGLE OWNER (card 29, boards/project-backlog/29-selection-store-stale-session-write.md):
// this module is the ONLY place that loads or holds an in-memory
// `ChatSession`. src/sidepanel/stores/selection.svelte.ts used to keep its
// own private copy just to read/write the `selection` field, and that
// second copy going stale (it never saw messages the agent loop appended
// through THIS module's copy) is exactly what let `selectModel()` silently
// overwrite history with an emptier snapshot. `getSessionSelection` and
// `setSessionSelection` below are the fix: selection.svelte.ts now reads
// and writes the selection field through the SAME live object every other
// mutator in this file uses, so a write can never be based on a copy it
// did not just read. That invariant still holds under the id-keyed model —
// only the tab-identity guard they use changed, from comparing the tab id
// stored ON the session to comparing against this module's own
// `activeTabId` (see the two functions' bodies).

import type { ChatMessage, ToolCall } from "../../lib/provider";
import type { ProviderSelection } from "../../lib/providers/registry";
import {
  completeToolCall,
  createChat,
  getChat,
  getOrCreateChatForTab,
  logToolCall,
  saveSession,
  setCurrentChatForTab,
  type ChatSession,
  type ToolCallLogEntry,
  type ToolCallMode,
} from "../../lib/session";
import type { SerializedTool, ToolAnnotations } from "../../lib/protocol";

export type MessageRole = "user" | "assistant" | "tool";

export type ToolCallStatus = "pending" | "success" | "error" | "denied";

/**
 * An action chip a plain assistant note can offer (card 14: connection
 * diagnostics). A copy-pasteable fix (e.g. the OLLAMA_ORIGINS command) is
 * NOT a kind here — it's embedded straight into the note's own markdown
 * content as a fenced code block instead, so it renders through
 * Markdown.svelte's existing code-block "Copy" button
 * (src/lib/markdown.ts's `renderCodeBlock`) rather than a second
 * copy-button implementation. These two kinds are for actions that aren't
 * expressible as copyable text:
 *   - `"retry"`: resend the last user turn (a stream that failed
 *     mid-generation keeps its partial reply on screen; this is the offered
 *     retry, never a silent auto-retry).
 *   - `"open-options"`: jump to the options page — used for an auth (401)
 *     failure, which is fixed by checking/re-entering an API key there, not
 *     by a command.
 */
export type PanelMessageAction = { kind: "retry" } | { kind: "open-options"; label: string };

/**
 * A displayable transcript entry. Structurally a superset of `ChatMessage`
 * (see module doc comment) — `role` is narrowed to the three roles ever
 * shown in the transcript (a system prompt is built fresh per turn by the
 * agent loop and never stored here).
 */
export interface PanelMessage extends ChatMessage {
  id: string;
  role: MessageRole;
  createdAt: number;
  /** Set on role:"tool" messages — the arguments the call was made with. */
  toolArgs?: Record<string, unknown>;
  toolStatus?: ToolCallStatus;
  /**
   * Set on role:"tool" messages — the approval outcome this call actually
   * ran under (card 09, decisions/05): `"auto"` for a call the policy let
   * through without a human decision (a `readOnlyHint` call under the
   * default policy, or ANY call under "auto-run-all"), `"approved"`/`"denied"`
   * for one a human decided. The approval UI (src/sidepanel/components/
   * ToolCallCard.svelte) uses this — not `tool.annotations` — to decide
   * whether a completed card starts collapsed: a call nobody had to review
   * stays out of the way; one a human actually approved or denied stays
   * visible, since that was a deliberate decision worth seeing.
   */
  toolMode?: ToolCallMode;
  /**
   * Set on role:"tool" messages — a snapshot of the matching tool's
   * `annotations` at call time (`undefined` if the tool wasn't found in the
   * page's current tool list, e.g. a hallucinated name). Lets the transcript
   * mark destructive-hint calls distinctly after the fact, without needing
   * the live (and possibly since-changed) tool list. Per decisions/05, this
   * is display metadata reported by the page — never treated as a security
   * guarantee.
   */
  toolAnnotations?: ToolAnnotations;
  /** Set on a plain assistant note (never on a live stream) that offers one or more action chips — see {@link PanelMessageAction}. */
  actions?: PanelMessageAction[];
}

/**
 * Placeholder connection state (card 07 scope note: "wire it to a
 * placeholder state your store exposes — do not import the provider
 * registry"). Card 20/23 is expected to call {@link setConnectionStatus}
 * from wherever it ends up owning the real `ChatProvider` health check.
 */
export type ConnectionStatus =
  | "unknown"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/** Identity of the page the panel is currently scoped to (decisions/01, /02). */
export interface PageInfo {
  tabId: number;
  title: string;
  origin: string;
  /**
   * The tab's own favicon, shown by ContextChip so the page the panel is
   * attached to is recognisable at a glance rather than only by its title.
   * Often absent (a tab that hasn't loaded one, a restricted page) — the
   * chip falls back to a generic globe glyph, never to a broken image.
   */
  favIconUrl?: string;
  toolCount: number;
  /**
   * Set when src/sidepanel/services/activeTab.ts's URL-based heuristic
   * recognizes this tab as one Chrome never allows a content script into
   * (chrome://, chrome-extension://, the Web Store, the built-in PDF
   * viewer — card 14). `toolCount` is always 0 here too, but for a
   * DIFFERENT reason than an ordinary page simply not publishing any
   * WebMCP tools, and that distinction is worth surfacing rather than
   * leaving the user to guess why nothing works on this tab.
   */
  restrictedReason?: string;
  /**
   * Whether `document.modelContext` exists on this tab at all
   * (decisions/16-native-webmcp-client.md, card 43). `false` means WebMCP is
   * off in this browser (no `--enable-features=WebMCP`, flag, or
   * origin-trial token) — a DISTINCT state from `true` + `toolCount: 0`,
   * which means the feature works here and this particular page simply
   * hasn't registered anything. Defaults to `true` when it can't be
   * determined yet (worker not reachable), so a transient startup gap never
   * flashes the "WebMCP unavailable" messaging for an ordinary page.
   */
  webmcpAvailable: boolean;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let session = $state<ChatSession | undefined>(undefined);
/** The tab this module is currently pointed at — NOT stored on `session` itself, since decision 13 lets a chat be viewed from a tab whose origin differs from the chat's own. Undefined until the first {@link syncSessionToTab} call. */
let activeTabId: number | undefined = undefined;
/** `activeTabId`'s REAL current origin — updated only by {@link syncSessionToTab} and {@link applyPanelNavigation}, never by {@link openChatInTab}, so a later actual navigation is detected against the tab's true history regardless of which chat happens to be open. */
let activeTabOrigin = "";
let streamingMessageId = $state<string | null>(null);
let connectionStatus = $state<ConnectionStatus>("unknown");
let pageInfo = $state<PageInfo | undefined>(undefined);
/** The active tab's current published tool list (card 11's inspector) — kept in sync by src/sidepanel/services/activeTab.ts, same source (`runtime:get-tools`/`runtime:tools-updated`) that already drives `pageInfo.toolCount`. */
let tools = $state<SerializedTool[]>([]);

/**
 * Registered by whoever owns the live generation (the agent loop,
 * src/sidepanel/services/agentLoop.ts). The composer's stop button calls
 * {@link requestStop}; it never touches an `AbortController` directly, so
 * the panel shell has no dependency on how generation is actually
 * implemented.
 */
let stopHandler: (() => void) | null = null;

export const panel = {
  /** A view over the active tab's `ChatSession.messages` — see module doc comment. Empty until a session has been loaded via {@link syncSessionToTab}. */
  get messages(): PanelMessage[] {
    return (session?.messages as PanelMessage[] | undefined) ?? [];
  },
  get streamingMessageId() {
    return streamingMessageId;
  },
  get isStreaming() {
    return streamingMessageId !== null;
  },
  get connectionStatus() {
    return connectionStatus;
  },
  get pageInfo() {
    return pageInfo;
  },
  /** The active tab's current tool list (card 11's Tools view). Empty until the first `runtime:get-tools` response lands. */
  get tools(): SerializedTool[] {
    return tools;
  },
  /** The active session's tool-call log (card 11's Call Log view) — same entries `addToolCall`/`updateToolCallResult` above write via `logToolCall`/`completeToolCall`, exposed read-only for the inspector. */
  get toolCalls(): ToolCallLogEntry[] {
    return session?.toolCalls ?? [];
  },
  /** The active chat's own id, or `undefined` if none is loaded yet — for the History view to know which entry is currently open. */
  get activeChatId(): string | undefined {
    return session?.id;
  },
  /**
   * The active chat's own `origin` — the origin it was STARTED against,
   * which is what the history list shows and, per decision 13, does not
   * have to match `pageInfo.origin`. Compare the two to detect the
   * cross-origin-open case; App.svelte does exactly that to show the
   * "this page's tools are not the ones this conversation used" notice.
   */
  get activeChatOrigin(): string | undefined {
    return session?.origin;
  },
  /**
   * Card 35: whether the active chat's persisted `selection` was set by a
   * deliberate user action rather than silently seeded from the stored
   * global default. See {@link setSessionSelection}'s `explicit` param and
   * `SessionWithSelectionMeta`'s doc comment above for why this can't live
   * on `ChatSession` itself. `false` (never `undefined`) when there's no
   * session, or no selection, loaded yet — nothing to have confirmed.
   */
  get selectionExplicit(): boolean {
    return (session as SessionWithSelectionMeta | undefined)?.selectionExplicit === true;
  },
};

// ---------------------------------------------------------------------------
// Session loading (the swap's entry points — see module doc comment and
// src/sidepanel/services/activeTab.ts)
// ---------------------------------------------------------------------------

/**
 * Point the panel at `tabId`/`origin`: resolves that tab's CURRENT chat
 * (its stored pointer, or a fresh chat if there is none/it's stale/it was
 * deleted — see `getOrCreateChatForTab`'s doc comment) and makes it the
 * live target for every mutator below. Call on initial mount and on every
 * real tab switch — never for a same-tab navigation, see
 * {@link applyPanelNavigation}.
 */
export async function syncSessionToTab(tabId: number, origin: string): Promise<void> {
  activeTabId = tabId;
  activeTabOrigin = origin;
  session = await getOrCreateChatForTab(tabId, origin);
  streamingMessageId = null;
  await setCurrentChatForTab(tabId, session.id, origin);
}

/**
 * Apply a same-tab navigation (decision 13): a real origin change retires
 * the current chat — it stays exactly as it is in storage, this tab simply
 * stops pointing at it — and starts a fresh one via {@link startNewChat}.
 * A no-op if the origin hasn't actually changed from what this tab was last
 * known to be at, or if no session/tab is loaded yet. Compares against this
 * module's own `activeTabOrigin`, not the loaded chat's `origin` — the two
 * can legitimately differ already if a history entry was opened
 * cross-origin (see `openChatInTab`), so this must not mistake "the user
 * opened an old chat from a different site" for "the tab just navigated".
 */
export async function applyPanelNavigation(newOrigin: string): Promise<void> {
  if (!session || activeTabId === undefined) return;
  if (activeTabOrigin === newOrigin) return;
  activeTabOrigin = newOrigin;
  await startNewChat(newOrigin);
}

/**
 * Retire the current tab's chat (leave it untouched in storage — it's
 * already committed if it has content, and if it's still empty nothing was
 * ever written for it) and start a fresh one for `origin`, carrying the
 * previous chat's provider/model selection over (a user preference, not
 * page state — same rationale decision 07 gave for the old per-tab reset).
 * No-op if no tab is loaded yet.
 *
 * Card 35's explicit-selection flag (see `panel.selectionExplicit` above) is
 * carried over alongside the selection itself: a choice the user already
 * confirmed stays confirmed in the fresh chat too ("remembering that choice
 * for subsequent chats is fine" — boards/project-backlog/35-force-explicit-model-selection.md).
 * This stays in-memory only, same as the carried-over `selection` itself
 * (`createChat` never writes to storage — see its doc comment) — tried
 * persisting it immediately once, but that made the fresh empty chat show
 * up in the History list right away with a "(no messages yet)" placeholder,
 * which is worse than the (rare: panel closed in the few seconds before the
 * first message) risk of losing the carry-over. Matches
 * `syncSessionToTab`'s existing fresh-chat behaviour, which already accepted
 * that same tradeoff before this card.
 *
 * Used internally by {@link applyPanelNavigation} for a cross-origin
 * navigation. Also exported as the SEAM card 36 ("New Chat",
 * boards/project-backlog/36-new-chat-action.md) uses: its header button
 * calls this directly (passing `pageInfo.origin`, i.e. "new chat for the
 * page I'm looking at right now") instead of a navigation event triggering
 * it — the retire-and-start-fresh behaviour itself is exactly this function
 * either way. That card guards against piling up empty duplicate chats by
 * simply not calling this at all when the current chat has no messages yet
 * (there's nothing to retire, so starting "fresh" would just be a second,
 * indistinguishable empty chat) — see App.svelte's `handleNewChat`.
 */
export async function startNewChat(origin: string): Promise<void> {
  if (activeTabId === undefined) return;
  const priorExplicit = (session as SessionWithSelectionMeta | undefined)?.selectionExplicit === true;
  session = createChat(origin, session?.selection);
  if (session.selection) (session as SessionWithSelectionMeta).selectionExplicit = priorExplicit;
  streamingMessageId = null;
  await setCurrentChatForTab(activeTabId, session.id, origin);
}

/**
 * Resume a past chat (card 34's History view) as the current tab's chat.
 * Allowed even when `chat.origin` differs from `pageInfo.origin` (decision
 * 13) — the transcript stays readable, but page tools keep coming from
 * `pageInfo`/`tools` (the CURRENT tab) regardless of which chat is open,
 * since those are never sourced from the chat object at all. Deliberately
 * does NOT touch `activeTabOrigin`, so a real navigation afterwards is
 * still measured against the tab's actual history (see module doc
 * comment). Returns `false` (no-op) if no tab is loaded yet or `chatId`
 * doesn't resolve to a stored chat (e.g. it was just deleted).
 */
export async function openChatInTab(chatId: string): Promise<boolean> {
  if (activeTabId === undefined) return false;
  const chat = await getChat(chatId);
  if (!chat) return false;
  session = chat;
  streamingMessageId = null;
  await setCurrentChatForTab(activeTabId, chat.id, activeTabOrigin);
  return true;
}

/**
 * If `chatId` is the chat currently open in this tab, replace it with a
 * fresh one (via {@link startNewChat}) so a later message can't resurrect
 * a chat the user just deleted (storage writes are keyed by chat id, so
 * continuing to write to the in-memory `session` object after its storage
 * record was removed would otherwise silently recreate it). Called by the
 * History view right after {@link deleteChat}/`clearAllChats`
 * (src/lib/session.ts) for whichever of those was the active chat. A no-op
 * for any other `chatId`.
 */
export async function discardActiveChatIfDeleted(chatId: string): Promise<void> {
  if (session?.id !== chatId || activeTabId === undefined) return;
  await startNewChat(activeTabOrigin);
}

function findMessage(id: string): PanelMessage | undefined {
  return (session?.messages as PanelMessage[] | undefined)?.find((m) => m.id === id);
}

// ---------------------------------------------------------------------------
// Selection field (owned in storage by this session, read/written on behalf
// of src/sidepanel/stores/selection.svelte.ts — see the SINGLE OWNER note
// in the module doc comment). Both functions no-op (return `undefined`
// / `false`) unless `tabId` matches the tab this module currently has
// loaded, so a caller can never read or write a session that isn't the one
// it thinks it is.
// ---------------------------------------------------------------------------

/** The live session's persisted `{providerId, model}` selection for `tabId`, or `undefined` if no session is loaded yet (or a different tab's is — checked against this module's `activeTabId`, since the chat object itself no longer carries a tab id, see module doc comment). Read-only — never returns a copy the caller could mistakenly persist later. */
export function getSessionSelection(tabId: number): ProviderSelection | undefined {
  return session && activeTabId === tabId ? session.selection : undefined;
}

/**
 * Card 35 (boards/project-backlog/35-force-explicit-model-selection.md):
 * `ChatSession` (src/lib/session.ts, out of this package's ownership) has
 * no field distinguishing a selection the user actually chose from one that
 * was silently seeded from the stored global default — both round-trip as
 * the exact same `{providerId, model}` shape. Rather than widen that type,
 * this stores one extra boolean alongside `selection` the same way
 * `PanelMessage` stores UI-only extras alongside `ChatMessage` (see this
 * module's header doc comment): not part of `ChatSession`'s declared type,
 * but `chrome.storage.local` round-trips arbitrary JSON shape regardless,
 * and `isChatSession`'s validator only checks for the fields it declares,
 * never rejects extras. A chat persisted before this field existed reads
 * back `undefined` here, which `panel.selectionExplicit` treats as
 * "not explicit" — the safer of the two readings when the data genuinely
 * can't say which it was (an already-blocked composer once, rather than
 * silently trusting an old implicit default forever).
 */
type SessionWithSelectionMeta = ChatSession & { selectionExplicit?: boolean };

/**
 * Persist `next` as `tabId`'s selection by mutating the SAME live session
 * object every mutator below writes to — never a separately-loaded
 * snapshot. This is what makes it safe to change the model mid-conversation:
 * whatever messages the agent loop has appended since this session was
 * loaded are still on `session.messages` when this saves, because it's the
 * identical object, not a copy read earlier (card 29's invariant: "no
 * writer may persist a session it did not just read"). Returns `false`
 * (and does not write anything) if no session is loaded for `tabId` yet —
 * the caller should not assume the write took effect.
 *
 * `explicit` records whether this write represents a deliberate user
 * choice (card 35) — `true` from the picker's `selectModel`/`confirmSelection`,
 * `false` from `syncToTab`'s silent default-seed. See
 * `panel.selectionExplicit`.
 */
export async function setSessionSelection(
  tabId: number,
  next: ProviderSelection,
  explicit: boolean,
): Promise<boolean> {
  if (!session || activeTabId !== tabId) return false;
  session.selection = next;
  (session as SessionWithSelectionMeta).selectionExplicit = explicit;
  await saveSession(session, { immediate: true });
  return true;
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

/** No-ops (returning `""`) if no session has been loaded yet — see {@link syncSessionToTab}. In practice the initial tab sync completes well before a user can type and hit send. */
export function addUserMessage(content: string): string {
  if (!session) return "";
  const id = makeId();
  const message: PanelMessage = { id, role: "user", content, createdAt: Date.now() };
  session.messages.push(message);
  void saveSession(session, { immediate: true });
  return id;
}

/** Starts a streaming assistant message (empty content) and marks it as the active stream. */
export function beginAssistantMessage(): string {
  if (!session) return "";
  const id = makeId();
  const message: PanelMessage = { id, role: "assistant", content: "", createdAt: Date.now() };
  session.messages.push(message);
  streamingMessageId = id;
  return id;
}

/** Append one token/delta to a streaming assistant message. Pass the WHOLE delta text (already-decoded), not raw wire bytes. Debounced write — see src/lib/session.ts's DEBOUNCE_MS/MAX_WAIT_MS; never called per-token without this debounce. */
export function appendAssistantDelta(id: string, delta: string): void {
  if (!session) return;
  const msg = findMessage(id);
  if (!msg) return;
  msg.content += delta;
  void saveSession(session);
}

/**
 * Marks a message's stream as finished. No-ops the `streamingMessageId`
 * clear if it wasn't the active stream (e.g. already stopped). Pass
 * `toolCalls` when the model's turn ended with `tool_calls` to attach — the
 * agent loop needs these persisted on the assistant message so the next
 * provider call can replay them correctly.
 */
export function endAssistantMessage(id: string, toolCalls?: ToolCall[]): void {
  if (streamingMessageId === id) streamingMessageId = null;
  if (!session) return;
  const msg = findMessage(id);
  if (!msg) return;
  if (toolCalls && toolCalls.length > 0) msg.toolCalls = toolCalls;
  void saveSession(session, { immediate: true });
}

/**
 * Adds a tool-call entry to the transcript (id = `call.id`, so it lines up
 * with the `toolCallId` a `role:"tool"` result must carry) and logs it into
 * the session's tool-call log via `logToolCall` (card 11's inspector).
 * `mode` is the approval outcome the caller already knows: `"auto"` for a
 * call the policy let through without a human decision, `"approved"`/
 * `"denied"` for one a human decided (card 09, decisions/05 — see
 * {@link PanelMessage.toolMode}). Denied calls are terminal — still call
 * {@link updateToolCallResult} right after to give the entry its display
 * content ("the user denied this call"), mirroring `logToolCall`'s doc
 * comment. Pass `annotations` from the matching tool descriptor (undefined
 * if none/unknown) so the transcript can flag a destructive-hint call after
 * the fact — see {@link PanelMessage.toolAnnotations}.
 */
export function addToolCall(
  call: ToolCall,
  mode: ToolCallMode,
  annotations?: ToolAnnotations,
): string {
  if (!session) return call.id;
  const message: PanelMessage = {
    id: call.id,
    role: "tool",
    content: "",
    createdAt: Date.now(),
    toolName: call.name,
    toolCallId: call.id,
    toolArgs: call.arguments,
    toolStatus: mode === "denied" ? "denied" : "pending",
    toolMode: mode,
    toolAnnotations: annotations,
  };
  session.messages.push(message);
  logToolCall(session, { id: call.id, name: call.name, arguments: call.arguments, mode });
  void saveSession(session, { immediate: true });
  return call.id;
}

/** Records the outcome of a previously-added tool call — both the transcript's display copy and the session's tool-call log (via `completeToolCall`). No-op (log-only) if `id` isn't a tracked tool message. */
export function updateToolCallResult(
  id: string,
  outcome: { status: ToolCallStatus; content: string },
): void {
  if (!session) return;
  const msg = findMessage(id);
  if (msg && msg.role === "tool") {
    msg.toolStatus = outcome.status;
    msg.content = outcome.content;
  }
  completeToolCall(
    session,
    id,
    outcome.status === "success" ? { result: outcome.content } : { error: outcome.content },
  );
  void saveSession(session, { immediate: true });
}

/**
 * Convenience for a one-shot assistant note that isn't part of a live
 * stream (e.g. "no provider selected", "stopped after N tool rounds", a
 * terminal provider error) — begins, appends, and ends a message in one
 * call. Pass `actions` (card 14) to attach action chips — e.g. `[{kind:
 * "retry"}]` on a note reporting a stream that failed mid-generation, so
 * the partial reply above it stays on screen exactly as it streamed and
 * this is the only new thing added, never a replacement for it.
 */
export function addAssistantNote(content: string, actions?: PanelMessageAction[]): string {
  const id = beginAssistantMessage();
  appendAssistantDelta(id, content);
  endAssistantMessage(id);
  if (actions && actions.length > 0) {
    const msg = findMessage(id);
    if (msg) msg.actions = actions;
    if (session) void saveSession(session, { immediate: true });
  }
  return id;
}

// ---------------------------------------------------------------------------
// Stop handling
// ---------------------------------------------------------------------------

export function setStopHandler(fn: (() => void) | null): void {
  stopHandler = fn;
}

/** Called by the composer's stop button. A no-op if nothing registered a handler (e.g. no generation in flight). */
export function requestStop(): void {
  stopHandler?.();
}

// ---------------------------------------------------------------------------
// Connection status (placeholder — see decisions/08 header note and the
// module doc comment above)
// ---------------------------------------------------------------------------

export function setConnectionStatus(status: ConnectionStatus): void {
  connectionStatus = status;
}

// ---------------------------------------------------------------------------
// Page identity (written by src/sidepanel/services/activeTab.ts)
// ---------------------------------------------------------------------------

export function setPageInfo(info: PageInfo): void {
  pageInfo = info;
}

export function setToolCount(tabId: number, count: number, available: boolean): void {
  if (pageInfo && pageInfo.tabId === tabId) {
    pageInfo = { ...pageInfo, toolCount: count, webmcpAvailable: available };
  }
}

/** Sets the active tab's full tool list (card 11's Tools view) — same `tabId` guard as {@link setToolCount} so a late response for a tab that's no longer active can't clobber what's on screen. */
export function setTools(tabId: number, next: SerializedTool[]): void {
  if (pageInfo && pageInfo.tabId === tabId) tools = next;
}

// Re-exported so consumers can type tool lists / the call log without
// reaching into src/lib/protocol.ts or src/lib/session.ts directly for
// these two types.
export type { SerializedTool };
export type { ToolCallLogEntry };
