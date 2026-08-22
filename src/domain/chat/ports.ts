// The DRIVEN PORTS of the `chat` context beyond persistence (card 77,
// decisions/29-ddd-hexagonal-typescript-layout.md). `ChatStore` (./store.ts)
// says where a conversation is kept; these say what a conversation needs from
// the world in order to HAPPEN: a model to stream from, a tool list to call
// into, a human to ask, and a surface to show progress on.
//
// Every one is an interface, declared here, implemented outside. Nothing in
// this folder imports `chrome.*`, `fetch`, the DOM or Svelte — which is the
// whole point: before this card the turn loop lived in
// src/sidepanel/services/agentLoop.ts and reached for `chrome.runtime`
// directly (its `callPageTool`), so the iteration cap, the approval gating
// and the untrusted-content fencing could only be exercised inside a browser.

import type { ChatParams, ChatStreamEvent, ToolCall } from "../providers";
import type { MergedTool } from "../tools";
import type { ChatSession } from "./session";
import type { TurnPhase } from "./turn-phase";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * The one thing a turn needs from a chat backend: a stream of events for a
 * request. Narrower than `ChatProvider` (src/domain/providers) on purpose —
 * a turn has no business listing models or resolving capabilities, and a
 * caller that only has a streaming endpoint should be able to run one.
 *
 * `ChatProvider` satisfies this structurally, so the side panel passes the
 * client it already resolved from the selection with no adapter in between;
 * the narrowing is a statement about what the loop may DO, not a second
 * shape to build.
 *
 * Never throws: every failure, including a request-setup failure, arrives as
 * a terminal `{type:"error"}` event. (./turn.ts still guards against a
 * violation of that contract — a stream that throws must not kill the loop.)
 */
export interface ModelGateway {
  chat(params: ChatParams): AsyncIterable<ChatStreamEvent>;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

/** The page a turn is being run against — named in the system prompt, and the tab whose tools this turn may call. */
export interface PageContext {
  tabId: number;
  title: string;
  origin: string;
}

/**
 * Resolves the callable tool list for ONE turn: the tab's current page tools
 * merged with whatever server tools are known, namespaced and
 * collision-resolved (decisions/19 §1/§5), each entry carrying its own bound
 * `call`. The loop resolves a model-requested name to an entry and invokes it
 * without ever branching on kind — and without knowing that a page tool's
 * `call` is a `chrome.runtime` round trip through the service worker while a
 * server tool's is an HTTP request.
 *
 * Built ONCE per turn (decisions/19 §5), so a tool list that changes
 * mid-generation cannot change what this turn is allowed to call halfway
 * through. Never throws — a failure to reach anything resolves as a shorter
 * list, never as a dead turn.
 */
export interface ToolExecutor {
  toolsForTurn(page: PageContext): Promise<MergedTool[]>;
}

// ---------------------------------------------------------------------------
// The human (decisions/05) — card 09 supplies the real requester
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  /** The call the model wants to make. */
  call: ToolCall;
  /**
   * The matching entry from this turn's MERGED tool list (page tools plus
   * every enabled MCP server's, decisions/19), if still known — annotations,
   * description, and ORIGIN (decisions/19 §6: the approval card must say
   * where a call will actually run) all come from here. `undefined` if the
   * model named a tool that isn't (or is no longer) in the list; that case
   * still requires approval, never auto-runs.
   */
  tool: MergedTool | undefined;
}

export type ApprovalDecision = "approved" | "denied";

/**
 * Injected async seam the loop `await`s before running any call its policy
 * gate (src/domain/settings's `ApprovalPolicyGate`) did not clear to auto-run.
 * This is what lets a turn suspend mid-iteration for a human decision without
 * blocking anything else — only this one call sits behind the promise;
 * content deltas, other chats' turns and the rest of the UI are untouched
 * while it is pending.
 *
 * Card 09 supplies the real implementation (an inline approve/deny card in the
 * transcript plus the session-scoped "don't ask again" skip lists) in
 * src/sidepanel/stores/approvals.svelte.ts. Card 77 moved this contract OUT of
 * the agent loop and into the domain: it used to be declared in
 * src/sidepanel/services/agentLoop.ts and imported back by its own consumer,
 * so the contract lived inside one of the two things it was meant to hold
 * apart.
 */
export type ApprovalRequester = (request: ApprovalRequest) => Promise<ApprovalDecision>;

/**
 * DEFAULT requester, used until a caller supplies a real one.
 *
 * ALWAYS DENIES. This is the fail-safe required by decisions/05: if the real
 * approval UI were somehow never wired in, every call that needs approval
 * fails closed — "the model couldn't act" — rather than silently auto-running
 * mutating calls on whatever page the panel happens to be open on.
 */
export const denyByDefaultApprovalRequester: ApprovalRequester = async () => "denied";

// ---------------------------------------------------------------------------
// The surface showing the conversation
// ---------------------------------------------------------------------------

/** A turn's contact with the model gateway, for whatever the surface shows as connection state. The domain reports the FACT; the UI owns the vocabulary it renders (a provider here is a stateless HTTP request, not a persistent connection, so "connected" can only ever mean "the last request succeeded"). */
export type ModelContactState = "requesting" | "succeeded" | "failed";

/**
 * How a running turn reports the state that is deliberately NOT persisted —
 * which message is receiving tokens, what phase the turn is in, whether the
 * model answered — and how it asks whether its own chat is the one on screen.
 *
 * Every method is keyed by chat id and never by "the current chat": A TURN
 * BELONGS TO A CHAT, NOT TO WHICHEVER TAB IS VISIBLE (decisions/25 §3, card
 * 58). A background turn keeps streaming into its own chat while the user
 * reads another; a surface that tracked one global "streaming message" would
 * clobber it on every swap, which is exactly the bug card 58 fixed.
 *
 * All four reporting methods are fire-and-forget and must not throw.
 */
export interface TurnPresenter {
  /** Replace `chatId`'s live phase (`null` clears it). See ./turn-phase.ts for the anti-flicker invariant the loop upholds around these calls. */
  phaseChanged(chatId: string, phase: TurnPhase | null): void;

  /** `messageId` is the assistant message now receiving tokens in `chatId`, or `null` when none is. */
  streamingChanged(chatId: string, messageId: string | null): void;

  /** The turn is about to talk to the model gateway, or has finished doing so. */
  modelContact(state: ModelContactState): void;

  /**
   * Resolves once `chatId` is the chat actually visible to the user —
   * immediately if it already is, and also if `signal` aborts (so a Stop on a
   * still-invisible background turn does not leave the wait dangling
   * forever).
   *
   * decisions/25's own consequences section accepts that "a background turn
   * that needs approval will wait"; this is that wait, made real rather than
   * left implicit. Without it the approval prompt would appear over whatever
   * chat the user happens to be looking at — and approving it would run a tool
   * call against a page they may not even realise the request is for.
   */
  waitUntilVisible(chatId: string, signal: AbortSignal): Promise<void>;
}

/**
 * The full surface port: {@link TurnPresenter} plus the one thing the SESSION
 * SWAP needs — a hand-off point when the chat on screen changes.
 *
 * `show` returns a `ChatSession` rather than `void`, and the service keeps
 * WHAT IT RETURNS as the object it mutates from then on. That is not
 * ceremony: a reactive UI may need to wrap a session before it can observe
 * changes to it (Svelte 5's `$state` hands back a Proxy over the object, and
 * mutating the raw target behind that Proxy's back updates the data without
 * ever invalidating anything that read it — a silently stale transcript).
 * Expressing the hand-off as `(ChatSession) => ChatSession` keeps that
 * framework fact entirely in the adapter: the default implementation is the
 * identity function, and this context still runs in a bare Node test.
 */
export interface ChatPresenter extends TurnPresenter {
  /**
   * `session` is becoming the chat on screen. Return the object every
   * subsequent read and mutation must go through — the same object, or a
   * wrapper over it with identical contents.
   */
  show(session: ChatSession): ChatSession;
}
