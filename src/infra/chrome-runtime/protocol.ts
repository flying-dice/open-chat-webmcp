// Shared message/type contracts used across all three extension contexts:
//
//   - ISOLATED-world relay   (src/content/relay.ts)
//   - background service worker (src/background/sw.ts)
//   - side panel / options Svelte apps (src/sidepanel, src/options)
//
// This is the single source of truth for cross-context messages (see
// decisions/03-vite-svelte-build.md). Other cards build *on* this file —
// extend it as new message kinds are needed, but do not change the shape of
// an existing message without updating every consumer, and keep the
// union exhaustive so a mismatch is a compile error rather than a silent
// no-op at runtime.
//
// Moved here from src/lib/protocol.ts in card 79
// (boards/project-backlog/79-protocol-and-timeout-ladder-cleanup.md,
// decisions/29-ddd-hexagonal-typescript-layout.md): this is the
// `chrome.runtime` messaging half of the chrome-runtime adapter (see
// ./README.md). A thin re-export was left behind at src/lib/protocol.ts for
// the two importers card 75 owned at the time; card 76 deleted it once
// those moved, so this file is now the only source of the protocol.
//
// There used to be a fourth context, a MAIN-world bridge (src/inject/bridge.ts)
// that provided/adopted `navigator.modelContext`, and a CustomEvent transport
// (BRIDGE_OUT_EVENT/BRIDGE_IN_EVENT) connecting it to the relay. Both are gone
// as of decisions/16-native-webmcp-client.md: the relay now reads
// `document.modelContext` directly from the ISOLATED world, which decisions/16
// confirmed against real Chrome builds is enough on its own — no page-world
// script required.

// ---------------------------------------------------------------------------
// Tool descriptors (decisions/16-native-webmcp-client.md)
// ---------------------------------------------------------------------------
//
// `ToolAnnotations` and `SerializedTool` moved to src/domain/tools/tool.ts in
// card 73 (decisions/29): they are the tool vocabulary the domain owns, and
// this file is the `chrome.runtime` messaging adapter that merely carries
// them. Re-exported here so every existing importer keeps working; the
// dependency points the right way (this module → domain), not the reverse.

export type { SerializedTool, ToolAnnotations } from "../../domain/tools";

import type { SerializedTool } from "../../domain/tools";

// The same arrangement for page context (card 118,
// decisions/40-page-context-access.md): `PageContextSnapshot` and
// `PageContextMode` are the `chat` context's vocabulary
// (src/domain/chat/page-context.ts) and this file is the messaging adapter
// that carries them across the relay -> worker -> panel hop. Re-exported so
// the relay and the worker can name the payload without either of them
// importing a domain context directly.

export type { PageContextMode, PageContextSnapshot } from "../../domain/chat";

import type { PageContextMode, PageContextSnapshot } from "../../domain/chat";

// ---------------------------------------------------------------------------
// Relay / side panel <-> background service worker (chrome.runtime messaging)
// ---------------------------------------------------------------------------

/** Relay -> Worker: this tab's tool list changed. */
export interface RuntimeToolsUpdatedMessage {
  type: "runtime:tools-updated";
  tabId: number;
  origin: string;
  /**
   * Whether `document.modelContext` exists on this page at all
   * (decisions/16-native-webmcp-client.md). WebMCP is off by default in
   * Chrome — no `--enable-features=WebMCP`/flag/origin-trial token means
   * `document.modelContext` is `undefined`, not an empty implementation.
   * That is a DISTINCT state from "the browser supports WebMCP and this page
   * simply hasn't registered any tools" (`available: true`, `tools: []`),
   * and the panel must be able to tell the two apart (card 43) rather than
   * showing an identical empty tool list either way.
   */
  available: boolean;
  tools: SerializedTool[];
}

/** Panel -> Worker: give me the current tool list for a tab. */
export interface RuntimeGetToolsRequest {
  type: "runtime:get-tools";
  tabId: number;
}

/** Worker -> Panel: response to {@link RuntimeGetToolsRequest}. */
export interface RuntimeGetToolsResponse {
  type: "runtime:get-tools-response";
  tabId: number;
  /** See {@link RuntimeToolsUpdatedMessage.available}. */
  available: boolean;
  /**
   * True when the worker could not reach ANY content relay in this tab at
   * all — the pattern-matched "Receiving end does not exist" /
   * "Could not establish connection" failure in src/background/sw.ts's
   * `looksLikeNoRelay`, which is what chrome://, chrome-extension://, the
   * Chrome Web Store, the built-in PDF viewer, and any other page Chrome
   * never allows a content script into all look like from the worker's side
   * (card 31, boards/project-backlog/31-restricted-page-detection-duplicated.md).
   *
   * This is a THIRD, more fundamental state than `available: false`: there,
   * a relay IS running and answered honestly that
   * `document.modelContext` doesn't exist; here, there is no relay at all to
   * even ask, so nothing will ever work on this tab. `available` is always
   * `false` alongside `restricted: true` (unknown, not "no"), and `tools` is
   * always empty. The panel must show a distinct message for this case
   * rather than folding it into "WebMCP not enabled" — see
   * src/sidepanel/components/ToolsPanel.svelte and
   * src/sidepanel/components/ContextChip.svelte.
   *
   * This is worker-only knowledge and has no counterpart on
   * {@link RuntimeToolsUpdatedMessage}: that message can only ever be sent
   * BY a relay that is alive, so it is never restricted by definition.
   */
  restricted: boolean;
  tools: SerializedTool[];
}

/** Panel -> Worker (-> Relay): invoke a tool in a given tab. */
export interface RuntimeCallToolRequest {
  type: "runtime:call-tool";
  tabId: number;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Worker -> Relay: the worker lost its in-memory per-tab tool registry (e.g.
 * the service worker was killed and restarted) and needs this tab's current
 * tool list resent immediately, rather than waiting for the next incidental
 * change. Sent via `chrome.tabs.sendMessage(tabId, ...)`; the relay answers
 * on the same channel with a {@link RuntimeToolsUpdatedMessage}. The worker
 * applies its own ~3s budget and falls back to an empty tool list if the
 * relay doesn't answer in time.
 */
export interface RuntimeRefreshToolsRequest {
  type: "runtime:refresh-tools";
}

/** Worker -> Panel: response to {@link RuntimeCallToolRequest}. */
export interface RuntimeCallToolResponse {
  type: "runtime:call-tool-response";
  ok: boolean;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Page context (card 118, decisions/40-page-context-access.md)
// ---------------------------------------------------------------------------

/**
 * Panel -> Worker (-> Relay): give me what the user chose to share from this
 * tab, right now.
 *
 * ONE request type with a `mode` field rather than two message types, and
 * that was a judgement call worth writing down. `selection` and `extract`
 * differ ONLY in which DOM read the relay performs; the routing, the timeout
 * rung, the restricted/unreachable handling and the response shape are
 * identical down to the field. Two message types would be two identical
 * routes through `sw.ts` and two identical branches in the relay's
 * `onMessage`, kept in step by hand — the exact drift `RUNTIME_MESSAGE_TYPES`
 * exists to prevent elsewhere. If a third mode ever needs a genuinely
 * different response (structured DOM, say), that is when it earns its own
 * message.
 *
 * PULL-ONLY. There is no `runtime:page-context-updated` notification and
 * there must not be one: decisions/40's privacy posture is that page content
 * moves only on an explicit user gesture, and the absence of a push message
 * is what makes "no background reads" a property of the protocol rather than
 * a promise about how the panel behaves.
 */
export interface RuntimeGetPageContextRequest {
  type: "runtime:get-page-context";
  tabId: number;
  mode: PageContextMode;
}

/** Worker -> Panel: response to {@link RuntimeGetPageContextRequest}. */
export interface RuntimeGetPageContextResponse {
  type: "runtime:get-page-context-response";
  tabId: number;
  ok: boolean;
  /**
   * Present exactly when `ok`. A snapshot with EMPTY text is a perfectly
   * ordinary success — the common answer to a `selection` pull, since most of
   * the time nothing is selected — and must never be reported as a failure
   * (see `PageContextSnapshot.text` in src/domain/chat/page-context.ts).
   */
  context?: PageContextSnapshot;
  /**
   * See {@link RuntimeGetToolsResponse.restricted} — the same worker-only,
   * authoritative "there is no relay in this tab at all" claim, and the same
   * distinction from a relay that merely did not answer in time. Always
   * `false` when `ok`.
   */
  restricted: boolean;
  /** Present when `!ok`: a developer-facing description of why. The panel maps the error KIND to user copy, never this string (decisions/34, decisions/37). */
  error?: string;
}

/** One-way notifications sent over `chrome.runtime.sendMessage` / `onMessage`. */
export type RuntimeNotification = RuntimeToolsUpdatedMessage;

/** Request/response pairs sent over `chrome.runtime.sendMessage` (or long-lived ports). */
export type RuntimeRequest =
  | RuntimeGetToolsRequest
  | RuntimeCallToolRequest
  | RuntimeRefreshToolsRequest
  | RuntimeGetPageContextRequest;
export type RuntimeResponse =
  | RuntimeGetToolsResponse
  | RuntimeCallToolResponse
  | RuntimeGetPageContextResponse;

export type RuntimeMessage = RuntimeNotification | RuntimeRequest | RuntimeResponse;

// ---------------------------------------------------------------------------
// Every message shape in the system, discriminated on `type`.
// Extend this union as new cards add message kinds — never invent an ad hoc
// message shape elsewhere. `isRuntimeMessage` below is DERIVED from this
// union (via `RUNTIME_MESSAGE_TYPES`), not hand-maintained in parallel with
// it: TypeScript's excess-property/missing-property checking on that object
// literal makes forgetting to register a new message type here a compile
// error, not a silent runtime gap.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * The single source of truth for "which `type` strings are valid runtime
 * messages" — a `Record` keyed by every member of the `RuntimeMessage["type"]`
 * union. Because `Record<K, V>` requires EXACTLY the keys of `K`, adding a
 * new message interface to the union above and forgetting to add its `type`
 * literal here (or vice versa: adding a stray key that isn't in the union) is
 * a TypeScript compile error, not a hand-maintained list that can silently
 * drift from the union it's supposed to mirror.
 */
const RUNTIME_MESSAGE_TYPES: Record<RuntimeMessage["type"], true> = {
  "runtime:tools-updated": true,
  "runtime:get-tools": true,
  "runtime:get-tools-response": true,
  "runtime:call-tool": true,
  "runtime:call-tool-response": true,
  "runtime:refresh-tools": true,
  "runtime:get-page-context": true,
  "runtime:get-page-context-response": true,
};

export function isRuntimeMessage(v: unknown): v is RuntimeMessage {
  return isRecord(v) && typeof v.type === "string" && Object.hasOwn(RUNTIME_MESSAGE_TYPES, v.type);
}
