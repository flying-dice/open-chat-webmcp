// `ChatService` — the DRIVING PORT of the `chat` context (card 77,
// decisions/29-ddd-hexagonal-typescript-layout.md). Everything a surface can
// do to a conversation goes through this interface: resolve which chat a tab
// is showing, swap to another one, append to the transcript, rename, run a
// turn. It is the module that used to be
// src/sidepanel/stores/panel.svelte.ts's non-view half — 1,201 lines in which
// the session aggregate, the swap policy, eleven storage call sites, the
// streaming buffers, the page identity and the per-tab selection all lived
// together, and which fifteen modules depended on.
//
// WHAT MOVED AND WHY. Three things in that store were rules about a
// conversation rather than about a panel:
//   1. WHICH CHAT A TAB IS SHOWING and what happens when that changes — the
//      pointer resolution, the retire-and-start-fresh on cross-origin
//      navigation (decision 13), the cross-origin open from History, the
//      "don't resurrect a chat the user just deleted" guard.
//   2. WHAT PERSISTS WHEN — the immediate/debounced split per mutator
//      (decisions/07, card 58), the rename that must NOT stamp `updatedAt`
//      (decisions/24 §5), the fact that a write failing must not be silent
//      (card 59).
//   3. WHICH OBJECT A WRITE LANDS ON — a turn belongs to a chat, not to
//      whichever tab is visible (decisions/25 §3, card 58): the live-session
//      registry, the explicit `target` on every mutator, and the one-shot
//      capture at the top of a turn.
// What stayed behind is genuinely view state: what is on screen, what is
// streaming, what phase a turn is in, what the page is.
//
// THE SVELTE PROXY HAND-OFF. This service holds the current `ChatSession` and
// mutates it in place. A reactive UI cannot simply be handed that object —
// Svelte 5's `$state` wraps it in a Proxy, and a mutation that bypasses the
// Proxy updates the data without invalidating anything that read it. So every
// session this service takes ownership of passes through
// `ChatPresenter.show`, whose return value is the object it keeps (see
// ./ports.ts). The default presenter's `show` is the identity function; the
// domain never learns that a Proxy exists.
//
// Pure: no `chrome.*`, no `fetch`, no DOM, no Svelte.

import type { ProviderSelection, ToolCall } from "../providers";
import type { ApprovalPolicyGate } from "../settings";
import type { ToolOrigin } from "../tools";
import {
  toolEntry,
  userEntry,
  assistantEntry,
  type NoteAction,
  type ToolCallSnapshot,
  type ToolCallStatus,
  type TranscriptEntry,
} from "./message";
import {
  completeToolCall,
  createChat,
  logToolCall,
  MAX_CHAT_PREVIEW_LENGTH,
  type ChatSession,
} from "./session";
import type { ChatStore } from "./store";
import { normalizeChatTitle } from "./title";
import type { ApprovalRequester, ChatPresenter, ModelGateway, PageContext, ToolExecutor } from "./ports";
import { runTurn, type TurnTranscript } from "./turn";

/** What a surface passes to {@link ChatService.runTurn} — the three ports that genuinely vary from one turn to the next, plus where the turn is happening. */
export interface RunTurnRequest {
  /** The resolved chat backend for the user's CURRENT selection. Varies per turn by definition — the user can change provider or model between messages. */
  model: ModelGateway;
  modelId: string;
  /** Resolves this turn's merged tool list. Per-turn because it is bound to the tab in front of the user right now. */
  tools: ToolExecutor;
  /** The human seam (card 09). Per-turn for the same reason `tools` is: it belongs to the surface running this turn. */
  approvals: ApprovalRequester;
  page: PageContext;
  /** Only ever `true` for a `"tool-capable"` model (decisions/11) — the service trusts the caller's gate and does not re-derive it. */
  attachTools: boolean;
}

/** A chat's persisted provider/model choice, plus whether the user actually made it (card 35). */
export interface StoredSelection {
  selection: ProviderSelection;
  explicit: boolean;
}

/** A snapshot of what the service holds in memory, for a diagnostic dump (card 59 item 6). Ids and counts only — never message text, tool arguments or results. */
export interface ChatServiceSnapshot {
  chatId: string | undefined;
  messageCount: number;
  toolCallCount: number;
  liveSessionIds: string[];
}

/**
 * Everything a surface may do to a conversation. Transcript mutators take an
 * explicit `target` and default to the current chat, so a one-shot caller
 * acting on what is on screen right now reads exactly as it did before card
 * 77, while a turn threads its captured session through every call.
 */
export interface ChatService extends TurnTranscript {
  /** The chat currently on screen, or `undefined` before the first {@link ChatService.syncToTab}. Never hold this across an `await`: by definition it may have moved on. */
  current(): ChatSession | undefined;

  /** The tab this service is currently pointed at — NOT stored on the session, since a chat may be viewed from a tab whose origin differs from its own (decision 13). */
  activeTabId(): number | undefined;

  /** `activeTabId`'s REAL current origin — updated only by {@link ChatService.syncToTab} and {@link ChatService.applyNavigation}, never by {@link ChatService.openChat}, so a later navigation is measured against the tab's true history regardless of which chat happens to be open. */
  activeTabOrigin(): string;

  /**
   * Point the service at `tabId`/`origin`: resolve that tab's CURRENT chat
   * (its stored pointer, or a fresh chat if there is none, it is stale, or it
   * was deleted) and make it the live target for every mutator. Call on
   * initial mount and on every real tab switch — never for a same-tab
   * navigation, see {@link ChatService.applyNavigation}.
   */
  syncToTab(tabId: number, origin: string): Promise<void>;

  /** Apply a same-tab navigation (decision 13): a real origin change RETIRES the current chat — it stays exactly as it is in storage, this tab simply stops pointing at it — and starts a fresh one. A no-op if the origin hasn't changed, if no chat is loaded, or if `tabId` is no longer the tab this service is pointed at. */
  applyNavigation(tabId: number, newOrigin: string): Promise<void>;

  /** Retire the current tab's chat and start a fresh one for `origin`, carrying the previous chat's provider/model selection (and card 35's explicit flag) over. Also the seam the "New Chat" button uses. No-op if no tab is loaded. */
  startNewChat(origin: string): Promise<void>;

  /** Resume a past chat (History) as the current tab's chat — allowed even cross-origin (decision 13). `false` if no tab is loaded or `chatId` no longer resolves. */
  openChat(chatId: string): Promise<boolean>;

  /** If `chatId` is the chat currently open in this tab, replace it with a fresh one, so a later message can't resurrect a chat the user just deleted. A no-op for any other id. */
  discardIfDeleted(chatId: string): Promise<void>;

  /** Rename the current chat (decisions/24 §4). An empty result UNSETS the name and reverts to the derived title. Persists immediately but WITHOUT stamping `updatedAt` — renaming is not conversation activity. */
  renameCurrent(title: string): Promise<void>;

  /** The current chat's persisted selection for `tabId`, or `undefined` if none is set (or a different tab's chat is loaded). */
  getSelection(tabId: number): StoredSelection | undefined;

  /** Persist `next` as `tabId`'s selection, by mutating the SAME live object every other mutator writes to — never a separately-loaded snapshot (card 27's invariant: no writer may persist a session it did not just read). `false` if no chat is loaded for `tabId`. */
  setSelection(tabId: number, next: ProviderSelection, explicit: boolean): Promise<boolean>;

  /** Append a user message to the current chat and return its id. `""` if no chat is loaded yet. */
  addUserMessage(content: string): string;

  /** Run one full agent turn for `userText` — see {@link runTurn}. Never throws. */
  runTurn(userText: string, request: RunTurnRequest): Promise<void>;

  /** Cancel the in-flight turn for `chatId`, if any. A no-op otherwise. */
  requestStop(chatId: string): void;

  /** Whether `chatId` has a turn in flight right now. */
  isTurnActive(chatId: string): boolean;

  snapshot(): ChatServiceSnapshot;
}

export interface ChatServiceDeps {
  store: ChatStore;
  /** How the surface shows a conversation and its live turn state — and the hand-off that lets a reactive UI own the session object. Defaults to a headless presenter that shows nothing and reports nothing. */
  presenter?: ChatPresenter;
  /** Decides whether a given tool call may run without asking a human (decisions/05, /20). */
  policy: ApprovalPolicyGate;
  /** Wording for a tool's origin, used in the system prompt (decisions/19 §6) — presentation, so it is injected rather than owned here (see `RunTurnOptions.originLabel` in ./turn.ts). */
  originLabel: (origin: ToolOrigin) => string;
  /** The outermost rung of the tool-call timeout ladder, in ms (see `RunTurnOptions.toolCallTimeoutMs`). */
  toolCallTimeoutMs: number;
  /**
   * Where a failed background write is reported (card 59 item 3). Every
   * transcript mutator persists fire-and-forget — they must stay
   * synchronous-feeling for streaming, so this does not block or retry; it
   * only makes a failure visible instead of a swallowed promise rejection.
   * Defaults to `console.error`, which is not a platform API and exists in a
   * bare Node test: the default is there so a save failure can never be
   * silent by omission, not because the domain has an opinion about sinks.
   */
  reportWriteFailure?: (message: string, cause: unknown) => void;
  /** Optional diagnostic trace for the swap path (card 59 item 1) — the panel gates this on its runtime tracing flag. */
  trace?: (event: string, detail: Record<string, unknown>) => void;
}

const headlessPresenter: ChatPresenter = {
  show: (session) => session,
  phaseChanged: () => undefined,
  streamingChanged: () => undefined,
  modelContact: () => undefined,
  waitUntilVisible: () => Promise.resolve(),
};

function makeMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const { store, policy } = deps;
  const presenter = deps.presenter ?? headlessPresenter;
  const reportWriteFailure =
    deps.reportWriteFailure ?? ((message: string, cause: unknown) => console.error(message, cause));
  const trace = deps.trace ?? (() => undefined);

  let session: ChatSession | undefined;
  let tabId: number | undefined;
  let tabOrigin = "";

  /**
   * Every chat with a turn currently in flight, keyed by chat id (decisions/25
   * §3, card 58). Consulted by {@link syncToTab}/{@link openChat} so
   * re-visiting a mid-generation chat re-attaches to the SAME object the turn
   * is mutating rather than a stale, half-written read from storage.
   */
  const liveSessions = new Map<string, ChatSession>();

  /** One stop handler per chat with a turn in flight — a single global here is exactly what let a second turn (or a tab switch mid-turn) silently clobber another chat's Stop. */
  const stopHandlers = new Map<string, () => void>();

  /** Takes ownership of `next` (see the module doc comment's proxy hand-off) and makes it the chat on screen. */
  function adopt(next: ChatSession): ChatSession {
    session = presenter.show(next);
    return session;
  }

  /**
   * Fire-and-forget persistence. Every transcript mutator writes through here
   * rather than `void store.save(...)`: a rejected write (a quota error, the
   * extension context invalidated mid-write) used to become an unhandled
   * rejection with no signal and no record of which chat it was.
   */
  function save(target: ChatSession, opts?: { immediate?: boolean; touch?: boolean }): void {
    void store.save(target, opts).catch((err: unknown) => {
      reportWriteFailure(`[webmcp][chat] save failed for chat ${target.id}`, err);
    });
  }

  function findEntry(target: ChatSession, id: string): TranscriptEntry | undefined {
    return target.messages.find((m) => m.id === id);
  }

  const service: ChatService = {
    current: () => session,
    activeTabId: () => tabId,
    activeTabOrigin: () => tabOrigin,

    async syncToTab(nextTabId, origin) {
      tabId = nextTabId;
      tabOrigin = origin;
      const { chat, resolved } = await store.getOrCreateChatForTab(nextTabId, origin);
      // Consult the live registry BEFORE accepting what storage just handed
      // back: if that chat has a turn in flight, the freshly-read copy is
      // already stale, and even if it weren't it is a structurally-equal but
      // DIFFERENT object — which is the whole reason a background turn's
      // accumulated deltas would otherwise vanish on switching back to it.
      const live = liveSessions.get(chat.id);
      const current = adopt(live ?? chat);
      // Skip the pointer write when the pointer already resolved (decisions/25
      // §2, card 57): it is correct by construction, so rewriting it on every
      // sync is churn — and for a chat mid-generation it would be actively
      // wrong, re-stamping a pointer a background turn may need untouched.
      if (!resolved) await store.setCurrentChatForTab(nextTabId, current.id, origin);
      trace("syncToTab", {
        tabId: nextTabId,
        chatId: current.id,
        messageCount: current.messages.length,
        resolved,
        reattachedLive: live !== undefined,
      });
    },

    async applyNavigation(forTabId, newOrigin) {
      // Tab-scoped (decisions/25 §2, card 57): refuse — WITHOUT touching
      // `tabOrigin` — when this is no longer the tab we are pointed at. The
      // caller serializes its own calls, but the `chrome.tabs` events behind
      // them are not serialized by Chrome itself, so a navigation event for a
      // tab the user has since left could otherwise retire whatever chat
      // happens to be current by the time it runs.
      if (!session || tabId === undefined || tabId !== forTabId) return;
      // Compared against the TAB's last known origin, not the loaded chat's —
      // the two can legitimately differ already if a History entry was opened
      // cross-origin, and "the user opened an old chat from another site" must
      // not be mistaken for "the tab just navigated".
      if (tabOrigin === newOrigin) return;
      tabOrigin = newOrigin;
      await service.startNewChat(newOrigin);
    },

    async startNewChat(origin) {
      if (tabId === undefined) return;
      // Card 35: a choice the user already confirmed stays confirmed in the
      // fresh chat too. Carried in memory only, exactly like the selection
      // itself — persisting the fresh chat immediately would put a
      // "(no messages yet)" placeholder at the top of History, which is worse
      // than the rare loss of the carry-over if the panel closes in the
      // seconds before the first message.
      const carried = session?.selection;
      const carriedExplicit = session?.selectionExplicit === true;
      const next = createChat(origin, carried);
      if (next.selection) next.selectionExplicit = carriedExplicit;
      adopt(next);
      await store.setCurrentChatForTab(tabId, next.id, origin);
    },

    async openChat(chatId) {
      if (tabId === undefined) return false;
      const live = liveSessions.get(chatId);
      const chat = live ?? (await store.getChat(chatId));
      if (!chat) return false;
      const current = adopt(chat);
      // Deliberately does NOT touch `tabOrigin`: a real navigation afterwards
      // must still be measured against the tab's actual history, not against
      // the origin of whatever history entry was opened.
      await store.setCurrentChatForTab(tabId, current.id, tabOrigin);
      return true;
    },

    async discardIfDeleted(chatId) {
      if (session?.id !== chatId || tabId === undefined) return;
      await service.startNewChat(tabOrigin);
    },

    async renameCurrent(title) {
      if (!session) return;
      const next = normalizeChatTitle(title, MAX_CHAT_PREVIEW_LENGTH);
      if (next) session.title = next;
      else delete session.title;
      // `touch: false` — History is ordered by `updatedAt`, and relabelling a
      // chat is not conversation activity (decisions/24 §5).
      await store.save(session, { immediate: true, touch: false });
    },

    getSelection(forTabId) {
      if (!session || tabId !== forTabId || !session.selection) return undefined;
      return { selection: session.selection, explicit: session.selectionExplicit === true };
    },

    async setSelection(forTabId, next, explicit) {
      if (!session || tabId !== forTabId) return false;
      session.selection = next;
      session.selectionExplicit = explicit;
      await store.save(session, { immediate: true });
      return true;
    },

    // -----------------------------------------------------------------------
    // Transcript mutators. Each writes AND persists; the immediate/debounced
    // split is stated once, here, rather than at every call site:
    //   - everything except a streaming delta writes immediately — none of
    //     them happens token-by-token, so there is no debounce reason to
    //     delay them, and `beginAssistantMessage` writing immediately (card
    //     58) is what makes an in-flight reply durable from the moment it
    //     starts rather than only once its first delta lands.
    //   - `appendAssistantDelta` is the token-by-token one and takes the
    //     store's debounce.
    // -----------------------------------------------------------------------

    addUserMessage(content) {
      if (!session) return "";
      const id = makeMessageId();
      session.messages.push(userEntry(id, content, Date.now()));
      save(session, { immediate: true });
      return id;
    },

    beginAssistantMessage(target = session) {
      if (!target) return "";
      const id = makeMessageId();
      target.messages.push(assistantEntry(id, Date.now()));
      save(target, { immediate: true });
      return id;
    },

    appendAssistantDelta(id: string, delta: string, target = session) {
      if (!target) return;
      const entry = findEntry(target, id);
      if (!entry) return;
      entry.content += delta;
      save(target);
    },

    endAssistantMessage(id: string, toolCalls?: ToolCall[], target = session) {
      if (!target) return;
      const entry = findEntry(target, id);
      if (!entry) return;
      if (toolCalls && toolCalls.length > 0) entry.toolCalls = toolCalls;
      save(target, { immediate: true });
    },

    addToolCall(call: ToolCall, snapshot: ToolCallSnapshot, target = session) {
      if (!target) return call.id;
      target.messages.push(toolEntry(call, snapshot, Date.now()));
      // The transcript's display copy and the inspector's call log (card 11)
      // are two views of the SAME call, kept in step by this mutator and
      // `updateToolCallResult` — never populated independently.
      logToolCall(target, {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        mode: snapshot.mode,
        origin: snapshot.origin,
      });
      save(target, { immediate: true });
      return call.id;
    },

    updateToolCallResult(
      id: string,
      outcome: { status: ToolCallStatus; content: string },
      target = session,
    ) {
      if (!target) return;
      const entry = findEntry(target, id);
      if (entry && entry.role === "tool") {
        entry.toolStatus = outcome.status;
        entry.content = outcome.content;
      }
      completeToolCall(
        target,
        id,
        outcome.status === "success" ? { result: outcome.content } : { error: outcome.content },
      );
      save(target, { immediate: true });
    },

    addAssistantNote(content: string, actions?: NoteAction[], target = session) {
      const id = service.beginAssistantMessage(target);
      service.appendAssistantDelta(id, content, target);
      service.endAssistantMessage(id, undefined, target);
      if (actions && actions.length > 0 && target) {
        const entry = findEntry(target, id);
        if (entry) entry.actions = actions;
        save(target, { immediate: true });
      }
      return id;
    },

    // -----------------------------------------------------------------------
    // Turns
    // -----------------------------------------------------------------------

    async runTurn(userText, request) {
      service.addUserMessage(userText);

      // THE ONE-SHOT CAPTURE (decisions/25 §3, card 58). Read here, right
      // after the user's message landed on whichever chat was current at that
      // instant, and never re-read: `session` may point at a different chat by
      // the time any `await` below resolves. Everything downstream takes this
      // exact object.
      const target = session;
      // No chat loaded — `addUserMessage` above already no-op'd, and there is
      // nothing to run a turn against. Shouldn't happen in practice: the
      // initial tab sync completes well before a user can type and send.
      if (!target) return;

      liveSessions.set(target.id, target);
      const controller = new AbortController();
      stopHandlers.set(target.id, () => controller.abort());

      try {
        await runTurn({
          target,
          transcript: service,
          model: request.model,
          modelId: request.modelId,
          tools: request.tools,
          approvals: request.approvals,
          policy,
          presenter,
          page: request.page,
          attachTools: request.attachTools,
          originLabel: deps.originLabel,
          toolCallTimeoutMs: deps.toolCallTimeoutMs,
          signal: controller.signal,
        });
      } finally {
        // decisions/26, card 60: the ONLY place a `TurnPhase` is cleared to
        // `null`. Every exit path a turn can take unwinds through here — a
        // clean finish, a terminal provider error, an abort, the iteration
        // cap, an unexpected throw — so clearing it here and ONLY here is what
        // guarantees the indicator can never blink off mid-turn. Do not add a
        // per-return clear anywhere else.
        presenter.phaseChanged(target.id, null);
        presenter.streamingChanged(target.id, null);
        stopHandlers.delete(target.id);
        liveSessions.delete(target.id);
      }
    },

    requestStop(chatId) {
      stopHandlers.get(chatId)?.();
    },

    isTurnActive(chatId) {
      return liveSessions.has(chatId);
    },

    snapshot() {
      return {
        chatId: session?.id,
        messageCount: session?.messages.length ?? 0,
        toolCallCount: session?.toolCalls.length ?? 0,
        liveSessionIds: [...liveSessions.keys()],
      };
    },
  };

  return service;
}
