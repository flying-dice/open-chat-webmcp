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
import { fail, ok, type Result } from "../result";
import type { StorageError } from "../storage";
import type { ApprovalPolicyGate } from "../settings";
import type { ToolOrigin } from "../tools";
import {
  noteEntry,
  toolEntry,
  userEntry,
  assistantEntry,
  type NoteAction,
  type SharedContextMarker,
  type ToolCallSnapshot,
  type ToolCallStatus,
  type TranscriptEntry,
  type TranscriptNote,
} from "./message";
import {
  completeToolCall,
  createChat,
  logToolCall,
  MAX_CHAT_PREVIEW_LENGTH,
  type ChatSession,
} from "./session";
import { newId } from "./id";
import type { PageContextSnapshot } from "./page-context";
import type { ChatStore } from "./store";
import { normalizeChatTitle } from "./title";
import type {
  ApprovalRequester,
  ChatPresenter,
  ModelGateway,
  PageContext,
  ToolExecutor,
} from "./ports";
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
  /**
   * decisions/40's SHARING GATE, as the turn sees it: `false` once the user
   * has dismissed sharing for the page this turn runs against, which makes
   * the assistant fully blind to it — no tools, no context, regardless of
   * what any other option on this request says.
   *
   * Passed even though the side panel already refuses to assemble a turn's
   * tools or context while it is `false` (card 119's
   * src/sidepanel/stores/pageSharing.svelte.ts). A consent gate enforced only
   * in the UI is a promise about one caller's discipline; enforced here it is
   * a property of running a turn at all. Card 120 extends that to the
   * page-context half when it lands the fencing.
   */
  sharingAllowed: boolean;
  /**
   * What the user explicitly shared from the page for THIS turn (card 118's
   * `PageContextSnapshot`), in the order it should reach the model — the side
   * panel puts a selection before a whole-page extract, since the selection
   * is the more specific answer to "what am I asking about".
   *
   * Card 119 uses this for one thing only: recording the transcript marker on
   * the user's message. Putting the fenced text into the prompt is card 120's
   * (decisions/40's untrusted-content rule, decisions/17's mechanism), which
   * is why this reaches ./turn.ts as data it does not yet read.
   */
  pageContext?: readonly PageContextSnapshot[] | undefined;
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
 *
 * WHICH METHODS CARRY A `StorageError`, AND WHY (card 95,
 * decisions/34-errors-as-values.md). Three postures, chosen per method rather
 * than uniformly — "every signature returns a `Result`" would be ceremony,
 * and a `Result` nobody can act on is worse than an honest `void`:
 *
 *  1. RETURNED — the five methods a USER drives (`openChat`,
 *     `startNewChat`, `discardIfDeleted`, `renameCurrent`, `setSelection`).
 *     Each is the direct consequence of something the user just did, so its
 *     caller has an affordance for the failure: leave History open, show a
 *     notice, keep the form up. The error member means exactly one thing —
 *     STORAGE DID NOT TAKE IT — and where the swap could be avoided it was
 *     (see `openChat`/`startNewChat`: the tab pointer is written BEFORE the
 *     visible chat changes, so a failed write leaves the screen truthful
 *     rather than showing a chat the tab does not point at).
 *  2. ABSORBED AND REPORTED — `syncToTab` and `applyNavigation`. Their only
 *     driver is a `chrome.tabs` event (src/infra/chrome-runtime/tab-sync.ts):
 *     nobody asked for the swap, nothing is waiting on its result, and there
 *     is no surface to tell. The recovery lives INSIDE them (leave the
 *     service pointed where it was rather than adopt a fabricated empty
 *     chat), and the reason goes to `ChatServiceDeps.reportStorageFailure`.
 *  3. NOT ASYNC AT ALL — the transcript mutators, which persist
 *     fire-and-forget so a token stream never waits on a write. Same sink as
 *     (2); see `save` in the implementation.
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
   *
   * Posture (2) above: a store that does not answer leaves the service
   * pointed where it was and is reported, not returned.
   */
  syncToTab(tabId: number, origin: string): Promise<void>;

  /** Apply a same-tab navigation (decision 13): a real origin change RETIRES the current chat — it stays exactly as it is in storage, this tab simply stops pointing at it — and starts a fresh one. A no-op if the origin hasn't changed, if no chat is loaded, or if `tabId` is no longer the tab this service is pointed at. Posture (2): reported, not returned. */
  applyNavigation(tabId: number, newOrigin: string): Promise<void>;

  /** Retire the current tab's chat and start a fresh one for `origin`, carrying the previous chat's provider/model selection (and card 35's explicit flag) over. Also the seam the "New Chat" button uses. `ok()` and a no-op if no tab is loaded; a failed tab-pointer write leaves the CURRENT chat on screen and comes back as the error, so the panel never shows a fresh chat the tab does not point at. */
  startNewChat(origin: string): Promise<Result<void, StorageError>>;

  /** Resume a past chat (History) as the current tab's chat — allowed even cross-origin (decision 13). `ok(false)` if no tab is loaded or `chatId` no longer resolves — the chat is simply not there, which is not a failure; the error member is for a store that could not be READ or could not record the tab's new pointer, in which case nothing was swapped and the caller should stay where it is. */
  openChat(chatId: string): Promise<Result<boolean, StorageError>>;

  /** If `chatId` is the chat currently open in this tab, replace it with a fresh one, so a later message can't resurrect a chat the user just deleted. A no-op (and `ok()`) for any other id; otherwise exactly {@link ChatService.startNewChat}'s result. */
  discardIfDeleted(chatId: string): Promise<Result<void, StorageError>>;

  /** Rename the current chat (decisions/24 §4). An empty result UNSETS the name and reverts to the derived title. Persists immediately but WITHOUT stamping `updatedAt` — renaming is not conversation activity. The new name is applied to the live session first, so an error means "shown, but not durable" — the caller says so rather than reverting a name the user is looking at. */
  renameCurrent(title: string): Promise<Result<void, StorageError>>;

  /** The current chat's persisted selection for `tabId`, or `undefined` if none is set (or a different tab's chat is loaded). */
  getSelection(tabId: number): StoredSelection | undefined;

  /** Persist `next` as `tabId`'s selection, by mutating the SAME live object every other mutator writes to — never a separately-loaded snapshot (card 27's invariant: no writer may persist a session it did not just read). `ok(false)` if no chat is loaded for `tabId`; the error member means the choice is live in this panel but did not reach storage. */
  setSelection(
    tabId: number,
    next: ProviderSelection,
    explicit: boolean,
  ): Promise<Result<boolean, StorageError>>;

  /** Append a user message to the current chat and return its id. `""` if no chat is loaded yet. `sharedContext` records what page context the message carried (card 119, decisions/40) and is omitted for the ordinary turn that carried none. */
  addUserMessage(content: string, sharedContext?: readonly SharedContextMarker[]): string;

  /** Run one full agent turn for `userText` — see {@link runTurn}. Never throws. */
  runTurn(userText: string, request: RunTurnRequest): Promise<void>;

  /** Cancel the in-flight turn for `chatId`, if any. A no-op otherwise. */
  requestStop(chatId: string): void;

  /** Whether `chatId` has a turn in flight right now. */
  isTurnActive(chatId: string): boolean;

  snapshot(): ChatServiceSnapshot;
}

/**
 * Which absorbed call produced a {@link StorageFailureReport} — see
 * `ChatService`'s postures (2) and (3) for what "absorbed" means. A root
 * switches on this to decide WHERE a report goes; it never sees an English
 * fragment to parse.
 *
 *   - `"transcript-write"` — posture (3): a transcript mutator's
 *     fire-and-forget `save`. The one a person can act on (card 106): the
 *     conversation on screen is not being saved.
 *   - `"tab-sync-read"` — posture (2): `syncToTab` could not resolve the
 *     tab's chat. Event-driven, nothing waiting on it.
 *   - `"tab-pointer-write"` — posture (2): `syncToTab`'s write of the tab's
 *     resolved pointer.
 *   - `"navigation-retry"` — posture (2): `applyNavigation`'s call to
 *     `startNewChat` after a same-tab origin change.
 */
export type StorageFailureOperation =
  | "transcript-write"
  | "tab-sync-read"
  | "tab-pointer-write"
  | "navigation-retry";

/**
 * What `ChatServiceDeps.reportStorageFailure` is handed instead of a
 * developer string (card 106, filed by card 96's audit) — enough for a root
 * to build BOTH a log line and, for the one operation a person can act on,
 * localized user-facing prose, without this module owning any copy of its
 * own (decisions/33-shared-ui-layer.md: prose is built from a `kind`/here, an
 * `operation`, never from a domain-authored sentence).
 *
 * Two shapes, because a report can mean two different things to a UI that
 * keeps a persistent notice up for `"transcript-write"`:
 *
 *   - `kind: "failed"` — every absorbed failure, for all four operations.
 *   - `kind: "recovered"` — fires ONLY for `"transcript-write"`, and only
 *     once a chat that had a PRIOR failed write saves successfully again.
 *     This is the retraction signal a persistent notice needs; the other
 *     three operations are each one absorbed call rather than a stream of
 *     retries against the same target, so there is nothing to retract.
 */
export type StorageFailureReport =
  | {
      kind: "failed";
      operation: StorageFailureOperation;
      /** The chat this happened to, when the operation is chat-scoped (`"transcript-write"`). `undefined` for a tab-scoped operation. */
      chatId: string | undefined;
      /** The tab this happened to, when the operation is tab-scoped. `undefined` for `"transcript-write"`, which is scoped to a chat regardless of which tab is showing it. */
      tabId: number | undefined;
      error: StorageError;
    }
  | {
      kind: "recovered";
      operation: "transcript-write";
      chatId: string;
    };

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
   * Where a storage failure this service ABSORBS is reported (card 59 item 3,
   * widened by card 92, narrowed to its shape by card 95, widened again to a
   * typed {@link StorageFailureReport} by card 106).
   *
   * Exactly four call sites reach it, and all are ones with nowhere to
   * return to (see `ChatService`'s postures (2) and (3); see
   * {@link StorageFailureOperation} for which is which). A root is expected
   * to route ONLY `"transcript-write"` reports to a user-visible surface —
   * card 96's audit judged that the one absorbed failure a person can act on
   * (the conversation on screen is not being saved), and the other three are
   * driven by a `chrome.tabs` event nobody asked for, with no view left to
   * tell.
   *
   * Every OTHER failure in this file is now in a signature. Nothing reaches
   * here that a caller could have been told about.
   *
   * Defaults to a `console` sink, which is not a platform API and exists in
   * a bare Node test: the default is there so a failure can never be silent
   * by omission, not because the domain has an opinion about where reports
   * ultimately go.
   */
  reportStorageFailure?: (report: StorageFailureReport) => void;
  /** Optional diagnostic trace for the swap path (card 59 item 1) — the panel gates this on its runtime tracing flag. */
  trace?: (event: string, detail: Record<string, unknown>) => void;
}

/**
 * The transcript markers a turn's request earns (card 119, decisions/40) —
 * one per snapshot the surface actually attached, in the same order.
 *
 * THE GATE IS APPLIED HERE TOO, not just where the snapshots were pulled: a
 * turn assembled with `sharingAllowed: false` records nothing, so a marker
 * can never claim the model was shown a page the user had made it blind to.
 * An empty snapshot earns no marker either — decisions/40's "empty is a
 * successful answer" means "there was nothing to share", and a marker saying
 * text was shared when none was would be the transcript lying about the
 * privacy-relevant fact it exists to record.
 */
function sharedContextMarkers(request: RunTurnRequest): SharedContextMarker[] {
  if (!request.sharingAllowed) return [];
  return (request.pageContext ?? [])
    .filter((snapshot) => snapshot.text !== "")
    .map((snapshot) => ({
      kind: snapshot.mode === "selection" ? "page-selection" : "page-content",
      truncated: snapshot.truncated,
    }));
}

const headlessPresenter: ChatPresenter = {
  show: (session) => session,
  phaseChanged: () => undefined,
  streamingChanged: () => undefined,
  modelContact: () => undefined,
  waitUntilVisible: () => Promise.resolve(),
};

// TODO: clean-code - 0.25 - SRP: createChatService bundles four related-but-distinct responsibilities (tab->chat resolution/navigation, provider/model selection state, transcript mutation, turn lifecycle/stop-handling) into one port — a deliberate consolidation per the module header, but still a wide surface.
export function createChatService(deps: ChatServiceDeps): ChatService {
  const { store, policy } = deps;
  const presenter = deps.presenter ?? headlessPresenter;
  const reportStorageFailure =
    deps.reportStorageFailure ??
    ((report: StorageFailureReport) => {
      if (report.kind === "failed") console.error(`[webmcp][chat] ${report.operation}`, report);
      else console.info(`[webmcp][chat] ${report.operation} recovered`, report);
    });
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
  /**
   * How many `runTurn` calls are currently in flight for a chat id (card 87
   * fix). Two turns racing for the SAME chat (a doubled-up "send" click, or
   * a retry fired before the first request settled) is never guarded
   * against elsewhere in this port, so `runTurn`'s `finally` must not
   * unconditionally clear `liveSessions`/`stopHandlers` for its chat id —
   * that would clear the SECOND turn's still-live registration out from
   * under it the moment the FIRST one finishes. Registration is instead
   * turn-scoped via this refcount: only the turn that brings the count back
   * to zero actually tears the registration down.
   */
  const activeTurnCounts = new Map<string, number>();

  /** One stop handler per chat with a turn in flight — a single global here is exactly what let a second turn (or a tab switch mid-turn) silently clobber another chat's Stop. */
  const stopHandlers = new Map<string, () => void>();

  /**
   * Chat ids whose last reported transcript write FAILED and has not yet been
   * followed by a success (card 106). What lets `save` tell "still broken" —
   * report nothing new, a UI's existing notice already says it — apart from
   * "fixed itself" — report `kind: "recovered"` exactly once, rather than on
   * every ordinary successful write.
   */
  const failingTranscriptWrites = new Set<string>();

  /** Takes ownership of `next` (see the module doc comment's proxy hand-off) and makes it the chat on screen. */
  function adopt(next: ChatSession): ChatSession {
    session = presenter.show(next);
    return session;
  }

  /**
   * Fire-and-forget persistence. Every transcript mutator writes through here
   * rather than `void store.save(...)`: a failed write (a quota error, the
   * extension context invalidated mid-write) used to become an unhandled
   * rejection with no signal and no record of which chat it was, and is now a
   * `"transcript-write"` {@link StorageFailureReport} against its chat id —
   * and, once storage is working again, the `"recovered"` report a
   * persistent notice needs to retract itself.
   */
  function save(target: ChatSession, opts?: { immediate?: boolean; touch?: boolean }): void {
    void store.save(target, opts).then(([, err]) => {
      if (err) {
        failingTranscriptWrites.add(target.id);
        reportStorageFailure({
          kind: "failed",
          operation: "transcript-write",
          chatId: target.id,
          tabId: undefined,
          error: err,
        });
      } else if (failingTranscriptWrites.delete(target.id)) {
        reportStorageFailure({
          kind: "recovered",
          operation: "transcript-write",
          chatId: target.id,
        });
      }
    });
  }

  /**
   * Awaited persistence for the two EVENT-DRIVEN lifecycle operations
   * (`syncToTab`'s tab-pointer write, `applyNavigation`'s retry) — the ones
   * left with nowhere to put a `StorageError`, because nobody asked them to
   * run (card 95; see `ChatService`'s posture (2)). Every user-driven method
   * returns its result instead of coming through here.
   */
  async function persist(
    operation: "tab-pointer-write" | "navigation-retry",
    forTabId: number,
    outcome: Promise<Result<unknown, StorageError>>,
  ): Promise<void> {
    const [, err] = await outcome;
    if (err) {
      reportStorageFailure({
        kind: "failed",
        operation,
        chatId: undefined,
        tabId: forTabId,
        error: err,
      });
    }
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
      const [resolvedTab, readErr] = await store.getOrCreateChatForTab(nextTabId, origin);
      if (readErr) {
        // Leave the service pointed where it was rather than adopting a
        // fabricated empty chat: an unreadable store is not the same fact as
        // "this tab has no chat", and swapping the transcript out on it would
        // show the user a blank conversation their history is still behind.
        reportStorageFailure({
          kind: "failed",
          operation: "tab-sync-read",
          chatId: undefined,
          tabId: nextTabId,
          error: readErr,
        });
        return;
      }
      const { chat, resolved } = resolvedTab;
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
      if (!resolved) {
        await persist(
          "tab-pointer-write",
          nextTabId,
          store.setCurrentChatForTab(nextTabId, current.id, origin),
        );
      }
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
      // Posture (2): a navigation is a browser event, not a request from a
      // person — `startNewChat`'s typed failure is absorbed here rather than
      // handed to a caller that does not exist.
      await persist("navigation-retry", forTabId, service.startNewChat(newOrigin));
    },

    async startNewChat(origin) {
      if (tabId === undefined) return ok();
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
      // POINTER FIRST, SWAP SECOND (card 95). The order was the other way
      // round while this method returned `void` and absorbed the failure —
      // harmless then, wrong now: a caller told "that did not save" would be
      // looking at the empty new chat anyway, with the old one already
      // retired off screen. Writing first means a failed write leaves the
      // conversation the user had exactly where it was.
      const [, err] = await store.setCurrentChatForTab(tabId, next.id, origin);
      if (err) return fail(err);
      adopt(next);
      return ok();
    },

    async openChat(chatId) {
      if (tabId === undefined) return ok(false);
      const live = liveSessions.get(chatId);
      let chat = live;
      if (!chat) {
        const [stored, err] = await store.getChat(chatId);
        // An unreadable store is NOT the same answer as "that chat is gone":
        // the caller keeps History open and says so either way, but only one
        // of the two is worth telling the user to try again about.
        if (err) return fail(err);
        chat = stored;
      }
      if (!chat) return ok(false);
      // Pointer first, swap second — same rule as `startNewChat` above, and
      // the reason History can report a failed open without the transcript
      // having already changed underneath it.
      //
      // Deliberately does NOT touch `tabOrigin`: a real navigation afterwards
      // must still be measured against the tab's actual history, not against
      // the origin of whatever history entry was opened.
      const [, writeErr] = await store.setCurrentChatForTab(tabId, chat.id, tabOrigin);
      if (writeErr) return fail(writeErr);
      adopt(chat);
      return ok(true);
    },

    async discardIfDeleted(chatId) {
      if (session?.id !== chatId || tabId === undefined) return ok();
      return service.startNewChat(tabOrigin);
    },

    async renameCurrent(title) {
      if (!session) return ok();
      const next = normalizeChatTitle(title, MAX_CHAT_PREVIEW_LENGTH);
      if (next) session.title = next;
      else delete session.title;
      // `touch: false` — History is ordered by `updatedAt`, and relabelling a
      // chat is not conversation activity (decisions/24 §5).
      //
      // The rename is applied to the live session BEFORE the write, and stays
      // applied if the write fails: the user typed it and is looking at it,
      // so silently putting the old name back would be a second surprise on
      // top of the first. The returned error is how the surface says it is
      // not durable yet.
      return store.save(session, { immediate: true, touch: false });
    },

    getSelection(forTabId) {
      if (!session || tabId !== forTabId || !session.selection) return undefined;
      return { selection: session.selection, explicit: session.selectionExplicit === true };
    },

    async setSelection(forTabId, next, explicit) {
      if (!session || tabId !== forTabId) return ok(false);
      session.selection = next;
      session.selectionExplicit = explicit;
      // Applied to the live session first, for card 27's reason (this must be
      // the SAME object every other mutator writes to, never a snapshot) —
      // which also means a failed write leaves the choice live for this panel
      // and merely not durable. The picker reports that; it does not undo a
      // selection the user is now chatting through.
      const [, err] = await store.save(session, { immediate: true });
      if (err) return fail(err);
      return ok(true);
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

    addUserMessage(content, sharedContext) {
      if (!session) return "";
      const id = newId();
      session.messages.push(userEntry(id, content, Date.now(), sharedContext));
      save(session, { immediate: true });
      return id;
    },

    beginAssistantMessage(target = session) {
      if (!target) return "";
      const id = newId();
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
      // A fresh, per-instance id — NOT `call.id` — so two calls sharing one
      // `call.id` in the same round (card 87: a hallucinating/buggy model
      // emitting a duplicate) still get their own addressable transcript
      // entry and call-log entry, rather than the second silently resolving
      // against the first's. `toolEntry` and `logToolCall` are given the
      // SAME minted id so `ToolCallRow.svelte`'s `entry.id === message.id`
      // lookup between the two views keeps working.
      const id = newId();
      target.messages.push(toolEntry(id, call, snapshot, Date.now()));
      // The transcript's display copy and the inspector's call log (card 11)
      // are two views of the SAME call, kept in step by this mutator and
      // `updateToolCallResult` — never populated independently.
      logToolCall(target, {
        id,
        name: call.name,
        arguments: call.arguments,
        mode: snapshot.mode,
        origin: snapshot.origin,
      });
      save(target, { immediate: true });
      return id;
    },

    updateToolCallResult(
      id: string,
      outcome: { status: ToolCallStatus; content: string; note?: TranscriptNote },
      target = session,
    ) {
      if (!target) return;
      const entry = findEntry(target, id);
      if (entry && entry.role === "tool") {
        entry.toolStatus = outcome.status;
        entry.content = outcome.content;
        // Card 114: `note` and `content` are exclusive by contract, but this
        // deletes rather than leaves a stale kind behind — the same entry is
        // written twice (pending, then its outcome) and a note from a
        // previous write would otherwise outlive the fact it described.
        if (outcome.note) entry.note = outcome.note;
        else delete entry.note;
      }
      // The call log is the SAME call seen from the inspector, so the code
      // travels with it (card 114) — see `ToolCallLogEntry.errorNote`.
      completeToolCall(
        target,
        id,
        outcome.status === "success"
          ? { result: outcome.content }
          : outcome.note
            ? { error: outcome.content, errorNote: outcome.note }
            : { error: outcome.content },
      );
      save(target, { immediate: true });
    },

    /**
     * Card 114 (decisions/38): builds the entry directly rather than through
     * `beginAssistantMessage`/`appendAssistantDelta`/`endAssistantMessage`.
     * That three-step dance existed only to push PROSE into `content` one
     * string at a time; a note has no content to append, so the detour is now
     * three storage writes to say one thing.
     */
    addAssistantNote(note: TranscriptNote, actions?: NoteAction[], target = session) {
      if (!target) return "";
      const id = newId();
      target.messages.push(noteEntry(id, note, Date.now(), actions));
      save(target, { immediate: true });
      return id;
    },

    // -----------------------------------------------------------------------
    // Turns
    // -----------------------------------------------------------------------

    async runTurn(userText, request) {
      service.addUserMessage(userText, sharedContextMarkers(request));

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
      activeTurnCounts.set(target.id, (activeTurnCounts.get(target.id) ?? 0) + 1);
      const controller = new AbortController();
      // A second concurrent turn for the same chat simply overwrites this
      // with its own controller — `requestStop` always aborts the LATEST
      // turn, the smallest honest behaviour when nothing upstream of this
      // port prevents two turns racing for one chat in the first place.
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
          sharingAllowed: request.sharingAllowed,
          pageContext: request.pageContext,
          originLabel: deps.originLabel,
          toolCallTimeoutMs: deps.toolCallTimeoutMs,
          signal: controller.signal,
        });
      } finally {
        // Turn-scoped teardown (card 87): only the turn that brings this
        // chat's active count back to zero clears the shared registration —
        // a sibling turn still in flight keeps `isTurnActive`/`requestStop`
        // (and, per decisions/26 below, the phase/streaming indicators)
        // working for however long IT still runs.
        const remaining = (activeTurnCounts.get(target.id) ?? 1) - 1;
        if (remaining > 0) {
          activeTurnCounts.set(target.id, remaining);
        } else {
          activeTurnCounts.delete(target.id);
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
