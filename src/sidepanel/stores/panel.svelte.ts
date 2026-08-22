// VIEW STATE for the side panel — and nothing else (card 77).
//
// This module was 1,201 lines: the session aggregate, the tab-swap policy,
// eleven `chrome.storage` call sites, the per-tab selection, the streaming
// buffers, the page identity and the tool lists, with fifteen dependents. The
// rules moved to `src/domain/chat` (`ChatService`, `runTurn`, the transcript
// vocabulary, the title and grouping derivations); what is left here is the
// answer to "what is on screen right now", which is genuinely a panel
// concern:
//
//   - the reactive handle on the visible `ChatSession`
//   - `streamingByChat` / `turnPhaseByChat` — live, per-chat, never persisted
//   - `connectionStatus`, `pageInfo`, `tools`, `serverTools`
//
// It keeps the getter-object-over-module-`$state` pattern: `panel` below is a
// plain object of getters, so a component reads `panel.messages` and Svelte
// tracks the underlying rune, without this module exporting mutable bindings.
//
// THE PRESENTER. `ChatService` (built by src/sidepanel/main.ts, reached here
// as `chat()`) owns the session; this module renders it. The two meet at `ChatPresenter`
// (src/domain/chat/ports.ts), implemented here:
//   - `show(session)` — the service is switching the visible chat. We assign
//     it to `$state` and return WHAT WE ASSIGNED, which is the Svelte 5 Proxy
//     over it. That return value is the object the service mutates from then
//     on, which is precisely what makes a background turn's accumulated
//     deltas appear the instant the user tabs back: mutating the raw target
//     behind the Proxy's back would update the data without invalidating
//     anything that read it.
//   - `phaseChanged`/`streamingChanged` — per chat id, because A TURN BELONGS
//     TO A CHAT, NOT TO WHICHEVER TAB IS VISIBLE (decisions/25 §3, card 58).
//     `panel.turnPhase`/`panel.streamingMessageId` report the VISIBLE chat's
//     entry only, by looking its id up in these maps.
//   - `modelContact` — the connection indicator. The domain reports the fact
//     ("a request is open" / "it succeeded"); the wording is ours.
//   - `waitUntilVisible` — how a background turn defers an approval prompt
//     until its own chat is on screen. Backed by `visibilityListeners`, which
//     `show` fires.
//
// THE TAB-SYNC VIEW. `tabSyncView` at the bottom of this file is the other
// inbound seam: src/infra/chrome-runtime/tab-sync.ts reports what the active
// tab currently IS (title, origin, favicon, tool list, and the two
// availability signals), and this module turns that into `PageInfo`. The
// adapter never learns that shape — card 78's whole point is that
// `chrome.tabs` and this store no longer see each other.
//
// WIRING (card 78): nothing is constructed here any more. `ChatService` is
// built by src/sidepanel/main.ts from the storage ports, the presenter below
// and the approval-policy gate, and reaches this module — like every other
// port — through `chat()` (src/sidepanel/app-services.ts). Card 77 wrote
// `createChatService` to take every dependency as an argument for exactly
// this move; nothing about the service changed to make it.

import type {
  ChatPresenter,
  ChatSession,
  ModelContactState,
  ToolCallLogEntry,
  TranscriptEntry,
  TurnPhase,
} from "../../domain/chat";
import type { Result } from "../../domain/result";
import type { StorageError } from "../../domain/storage";
import type { MergedTool, SerializedTool } from "../../domain/tools";
import { chat, sidePanelServices } from "../app-services";

/**
 * Connection state as the panel SHOWS it. `"unknown"`/`"disconnected"` exist
 * for a surface that has not talked to a provider yet; the running turn only
 * ever reports the three states `ModelContactState` names, which this maps
 * onto "connecting"/"connected"/"error". Providers here are stateless HTTP
 * requests, not a persistent connection, so "connected" can only ever mean
 * "the last request succeeded".
 */
export type ConnectionStatus = "unknown" | "connecting" | "connected" | "disconnected" | "error";

/** Identity of the page the panel is currently scoped to (decisions/01, /02). */
export interface PageInfo {
  tabId: number;
  title: string;
  origin: string;
  /**
   * The tab's own favicon, shown by ContextChip so the page the panel is
   * attached to is recognisable at a glance rather than only by its title.
   * Often absent (a tab that hasn't loaded one, a restricted page) — the chip
   * falls back to a generic globe glyph, never to a broken image.
   */
  favIconUrl?: string | undefined;
  toolCount: number;
  /**
   * True when the background worker could not reach ANY content relay in this
   * tab at all — chrome://, chrome-extension://, the Chrome Web Store, the
   * built-in PDF viewer, and any other page Chrome never allows a content
   * script into all surface this way (card 31). `toolCount` is always 0 here
   * too, but for a MORE FUNDAMENTAL reason than `webmcpAvailable: false` (a
   * relay IS running there, it just answered "WebMCP is off") or an ordinary
   * page simply not publishing any tools — nothing will EVER work here, and
   * that distinction is worth surfacing rather than leaving the user to guess.
   * The worker's own authoritative signal, not a client-side URL guess.
   */
  restricted: boolean;
  /**
   * Whether `document.modelContext` exists on this tab at all (decisions/16,
   * card 43). `false` means WebMCP is off in this browser — a DISTINCT state
   * from `true` + `toolCount: 0`, which means the feature works here and this
   * particular page simply hasn't registered anything. Defaults to `true`
   * when it can't be determined yet, so a transient startup gap never flashes
   * the "WebMCP unavailable" messaging for an ordinary page.
   */
  webmcpAvailable: boolean;
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

/** The visible chat, as a Svelte 5 reactive proxy. Assigned ONLY by the presenter's `show` below — the service is what decides which chat that is. */
let session = $state<ChatSession | undefined>(undefined);

/** Streaming assistant-message id per chat with an active stream, keyed by chat id (decisions/25 §3, card 58) — a single global here is exactly what let a tab switch stomp a background turn's stream state. */
let streamingByChat = $state<Record<string, string | null>>({});

/** `TurnPhase` per chat with a turn in flight — same shape and same reason as `streamingByChat`. Deliberately not persisted (decisions/26 §2): a stored "calling…" would be a lie the moment the panel reopens. */
let turnPhaseByChat = $state<Record<string, TurnPhase | null>>({});

let connectionStatus = $state<ConnectionStatus>("unknown");
let pageInfo = $state<PageInfo | undefined>(undefined);
/** The active tab's current published tool list (card 11's inspector) — kept in sync through `tabSyncView` below by src/infra/chrome-runtime/tab-sync.ts. */
let tools = $state<SerializedTool[]>([]);
/** Every currently-cached MCP server tool (card 38's Tools view, decisions/19 §6) — kept in sync by src/sidepanel/services/mcpTools.ts's background discovery, independent of which tab is active. Never network-blocking to read: always whatever that module's cache currently holds. */
let serverTools = $state<MergedTool[]>([]);

/** Listeners notified whenever the VISIBLE chat changes — the backing for the presenter's `waitUntilVisible`. */
const visibilityListeners = new Set<(chatId: string | undefined) => void>();

// ---------------------------------------------------------------------------
// The presenter (see the module doc comment)
// ---------------------------------------------------------------------------

export const presenter: ChatPresenter = {
  show(next: ChatSession): ChatSession {
    session = next;
    const adopted = session;
    for (const fn of visibilityListeners) fn(adopted.id);
    return adopted;
  },

  phaseChanged(chatId: string, phase: TurnPhase | null): void {
    if (phase) turnPhaseByChat[chatId] = phase;
    else delete turnPhaseByChat[chatId];
  },

  streamingChanged(chatId: string, messageId: string | null): void {
    if (messageId) streamingByChat[chatId] = messageId;
    else delete streamingByChat[chatId];
  },

  modelContact(state: ModelContactState): void {
    connectionStatus =
      state === "requesting" ? "connecting" : state === "succeeded" ? "connected" : "error";
  },

  waitUntilVisible(chatId: string, signal: AbortSignal): Promise<void> {
    if (session?.id === chatId || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        visibilityListeners.delete(onVisible);
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onVisible = (visibleId: string | undefined) => {
        if (visibleId === chatId) finish();
      };
      const onAbort = () => finish();
      visibilityListeners.add(onVisible);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
};

// ---------------------------------------------------------------------------
// What the UI reads
// ---------------------------------------------------------------------------

export const panel = {
  /** The visible chat's transcript, in the shape it is persisted in (src/domain/chat). Empty until a chat has been loaded. No cast: `ChatSession.messages` IS `TranscriptEntry[]` since card 77. */
  get messages(): TranscriptEntry[] {
    return session?.messages ?? [];
  },
  /** The VISIBLE chat's streaming assistant-message id, or `null` — a background chat's own stream state is never reported here, and switching TO a mid-generation chat picks its entry back up correctly. */
  get streamingMessageId(): string | null {
    return session ? (streamingByChat[session.id] ?? null) : null;
  },
  /** The VISIBLE chat's current `TurnPhase`, or `null` if it has no turn in flight. */
  get turnPhase(): TurnPhase | null {
    return session ? (turnPhaseByChat[session.id] ?? null) : null;
  },
  /**
   * True from the moment a turn starts to the moment it fully ends —
   * INCLUDING tool execution and approval waits, unlike `streamingMessageId`,
   * which is non-`null` only while tokens are landing in a specific message
   * and goes quiet the instant the loop closes an assistant message to run its
   * tool calls (decisions/26). This is the "a turn is in flight" predicate the
   * Stop button and the new-chat guard read.
   */
  get isTurnActive(): boolean {
    return session !== undefined && (turnPhaseByChat[session.id] ?? null) !== null;
  },
  get connectionStatus(): ConnectionStatus {
    return connectionStatus;
  },
  get pageInfo(): PageInfo | undefined {
    return pageInfo;
  },
  /** The active tab's current tool list (card 11's Tools view). Empty until the first `runtime:get-tools` response lands. */
  get tools(): SerializedTool[] {
    return tools;
  },
  /** Every currently-cached MCP server tool (card 38's Tools view). */
  get serverTools(): MergedTool[] {
    return serverTools;
  },
  /** The visible chat's tool-call log (card 11's Call Log view), read-only. */
  get toolCalls(): ToolCallLogEntry[] {
    return session?.toolCalls ?? [];
  },
  /** The visible chat's own id, or `undefined` if none is loaded yet — for the History view to know which entry is open. */
  get activeChatId(): string | undefined {
    return session?.id;
  },
  /**
   * The visible chat's own `origin` — the origin it was STARTED against, which
   * is what the history list shows and, per decision 13, does not have to
   * match `pageInfo.origin`. App.svelte compares the two to show the
   * "this page's tools are not the ones this conversation used" notice.
   */
  get activeChatOrigin(): string | undefined {
    return session?.origin;
  },
  /** The visible chat's explicit, user-set name (decisions/24), or `undefined` — in which case the header/menu/history derive one (src/domain/chat's `titleFromMessages`). */
  get activeChatTitle(): string | undefined {
    return session?.title;
  },
};

// ---------------------------------------------------------------------------
// Writers — the panel's own state only
// ---------------------------------------------------------------------------

/** Called by the composer's stop button: cancels the VISIBLE chat's turn specifically (decisions/25 §3), never a background one. A no-op if nothing is in flight for it. */
export function requestStop(): void {
  if (session) chat().requestStop(session.id);
}

/*
 * REMOVED (card 77): `setConnectionStatus`. It was card 07's placeholder
 * seam, and its one caller was the agent loop, which set it around the single
 * call site that actually talked to a provider. That is now
 * `presenter.modelContact` above — the domain reports the fact, this module
 * picks the word — so an exported setter would be a second, unowned way to
 * write the same state. `"unknown"` (the initial value) and `"disconnected"`
 * stay in the union: they are display vocabulary the chip and menu already
 * render, and "we have not talked to a provider yet" is still a real state.
 */

/** Sets the currently-cached MCP server tool list (card 38). Not tab-scoped: server tools aren't per-page, so there is no stale-tab race to guard against. */
export function setServerTools(next: MergedTool[]): void {
  serverTools = next;
}

// ---------------------------------------------------------------------------
// The tab-sync view (card 78)
// ---------------------------------------------------------------------------

/**
 * How src/infra/chrome-runtime/tab-sync.ts reports the active tab into this
 * store — wired to it by src/sidepanel/main.ts.
 *
 * This is the same three writers `src/sidepanel/services/activeTab.ts` used
 * to call as module imports (`setPageInfo`, `setToolCount`, `setTools`),
 * gathered into one object so the adapter depends on a shape rather than on
 * this module, with the `PageInfo` assembly kept on THIS side of the seam —
 * `restricted`/`webmcpAvailable`/`toolCount` are display vocabulary
 * (see `PageInfo` above), not something `chrome.tabs` should know it is
 * producing.
 */
export const tabSyncView = {
  pageResolved(page: {
    tabId: number;
    title: string;
    origin: string;
    favIconUrl?: string;
    tools: SerializedTool[];
    available: boolean;
    restricted: boolean;
  }): void {
    pageInfo = {
      tabId: page.tabId,
      title: page.title,
      origin: page.origin,
      favIconUrl: page.favIconUrl,
      toolCount: page.tools.length,
      restricted: page.restricted,
      webmcpAvailable: page.available,
    };
    // card 11's Tools view needs the full descriptors, not just the count.
    tools = page.tools;
  },

  /** A bare title/favicon change on the tab already on screen — no navigation, no tools lookup, everything else about the page left exactly as it was. */
  pageMetaChanged(meta: { title: string; favIconUrl?: string }): void {
    if (!pageInfo) return;
    pageInfo = { ...pageInfo, title: meta.title, favIconUrl: meta.favIconUrl };
  },

  /**
   * The worker's live `runtime:tools-updated` broadcast. Guarded on `tabId`
   * so a late response for a tab that is no longer the one on screen can't
   * clobber what is displayed.
   */
  toolsChanged(tabId: number, next: SerializedTool[], available: boolean): void {
    if (!pageInfo || pageInfo.tabId !== tabId) return;
    pageInfo = { ...pageInfo, toolCount: next.length, webmcpAvailable: available };
    tools = next;
  },
};

// ---------------------------------------------------------------------------
// Diagnostics (card 59 item 6)
// ---------------------------------------------------------------------------

/**
 * A snapshot of what the panel and its chat service currently hold in memory,
 * for scripts/dump-chat-storage.js to report next to what is on disk. The card
 * 57 dump proved storage was healthy while the panel showed the wrong chat —
 * but only by inference, since nothing could see the panel's memory. This
 * closes that gap.
 *
 * Deliberately NOT gated behind the tracing flag: it is one cheap function
 * that has to work against a real installed extension the next time this bites
 * in practice. Same privacy guarantee as the dump script itself — ids and
 * counts only, never message text, tool arguments or results.
 *
 * Also the ONE debug surface for the tracing runtime override:
 * `enableTracing`/`disableTracing` sit as properties on this same callable
 * rather than a second `window.*` global, and the snapshot reports
 * `tracingEnabled` so one paste shows whether tracing is on alongside
 * everything else. See src/infra/chrome-storage/debug-flags.ts for why a
 * runtime toggle (not just `import.meta.env.DEV`) is needed at all.
 *
 * Attached to `window` because the dump script is a devtools-console paste
 * with no module import path into this closure.
 */
declare global {
  interface Window {
    __webmcpPanelDebug?: (() => {
      chatId: string | undefined;
      messageCount: number;
      toolCallCount: number;
      streamingMessageId: string | null;
      turnPhaseByChat: Record<string, TurnPhase | null>;
      liveSessionIds: string[];
      tracingEnabled: boolean;
    }) & {
      enableTracing: () => Promise<Result<void, StorageError>>;
      disableTracing: () => Promise<Result<void, StorageError>>;
    };
  }
}

// Card 113: this was named `webmcpPanelDebugSnapshot`, which promised a pure
// read while carrying two state-MUTATING methods as properties on the same
// object. It is a debug HANDLE — call it for the snapshot, reach for its
// methods to flip tracing.
function webmcpPanelDebugHandle() {
  const snapshot = chat().snapshot();
  return {
    ...snapshot,
    streamingMessageId: snapshot.chatId ? (streamingByChat[snapshot.chatId] ?? null) : null,
    turnPhaseByChat: { ...turnPhaseByChat },
    tracingEnabled: sidePanelServices().tracing.isEnabled(),
  };
}
webmcpPanelDebugHandle.enableTracing = () => sidePanelServices().tracing.set(true);
webmcpPanelDebugHandle.disableTracing = () => sidePanelServices().tracing.set(false);
window.__webmcpPanelDebug = webmcpPanelDebugHandle;
