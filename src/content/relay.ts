// ISOLATED-world relay (decisions/16-native-webmcp-client.md).
//
// Runs in the extension's ISOLATED world, injected at document_start on every
// page. Reads `document.modelContext` DIRECTLY — decisions/16 measured
// against real Chrome 151/152 builds that an ISOLATED-world content script
// observes tools a page registered on itself in the MAIN world, because
// `document.modelContext` is a genuine Document-scoped IDL attribute, not
// per-JS-world state. There is no MAIN-world bridge any more (decisions/02,
// superseded by decisions/16): this file used to talk to one
// (`src/inject/bridge.ts`) over CustomEvents; now it talks to the browser's
// own implementation directly.
//
// Everything that crosses to the service worker is a typed message from
// src/infra/chrome-runtime/protocol.ts.
//
// Behaviours here are MEASURED, not guessed at from the published spec IDL
// (which disagrees with Chrome in several places) — see decisions/16:
//   - `ModelContextToolInfo.inputSchema` is a JSON STRING, parsed defensively
//     below (`parseInputSchema`).
//   - `executeTool(tool, inputArgs)`'s second argument is MID-MIGRATION in
//     Chrome itself, not just spec-vs-shipped: decisions/16 measured the
//     JSON-STRING form as what 151/152 requires today (an object throws
//     `UnknownError: Failed to parse input arguments`), but the official
//     inspector (beaufortfrancois/model-context-tool-inspector, content.js:
//     41-49, v1.9.14) tries the OBJECT form first and only falls back to the
//     string form on that exact error, with a TODO to drop the fallback once
//     Chrome Stable stops accepting it. `callExecuteTool` below mirrors that
//     shape instead of hardcoding one form, so this file doesn't silently
//     break when Chrome finishes the migration.
//   - `executeTool` takes the live `ModelContextToolInfo` OBJECT returned by
//     `getTools()`, not a name — the worker calls by name, so this file keeps
//     the latest objects around and resolves name -> object itself
//     (`resolveTool`), re-fetching once on a cache miss before giving up.
//     `getTools()` can also return tools registered by OTHER frames on the
//     same page (each entry carries its own `window`); the inspector scopes
//     its own lookup to `t.window === window` (content.js:38) so a call never
//     resolves to a same-named tool in a different frame, and this file does
//     the same (`refreshTools`) — consistent with this relay only running in
//     the top frame in the first place (`all_frames: false`,
//     manifest.config.ts).

import {
  isRuntimeMessage,
  type PageContextSnapshot,
  type RuntimeCallToolRequest,
  type RuntimeGetPageContextRequest,
  type RuntimeMessage,
  type RuntimeToolsUpdatedMessage,
  type SerializedTool,
  type ToolAnnotations,
} from "../infra/chrome-runtime";
// The page-context extraction (card 118, decisions/40-page-context-access.md).
// A pure pair of functions over a `Document` — this root passes it the real
// one; ../infra/dom/page-extraction.test.ts passes jsdom ones. Everything
// about WHICH document, WHEN, and WHO ASKED stays here, in the relay, which
// is the only code in this extension that touches a visited page.
import {
  extractPageText,
  extractSelection,
  PAGE_EXTRACT_CAP_BYTES,
  selectionIdentity,
} from "../infra/dom";
import { RELAY_EXECUTE_TIMEOUT_MS } from "../infra/webmcp";
// The shared result kernel (decisions/34-errors-as-values.md). A content
// script is a runtime surface like any other, and this is the one place in it
// where a known failure — a page's own tool refusing the call — travels as a
// value rather than as an exception.
import { fail, ok, type Result } from "../domain/result";
import type { ModelContextToolInfo } from "@mcp-b/webmcp-types";

// Round-trip budget for a worker-initiated tool call — the innermost rung of
// the shared timeout ladder (src/infra/webmcp/timeouts.mjs, card 79). The
// relay now owns execution directly against
// `document.modelContext.executeTool()` — the ladder lost its old
// MAIN-world-bridge rung (decisions/16) and is three layers today: this
// constant, src/background/sw.ts's SW_CALL_TIMEOUT_MS, and
// AGENT_LOOP_TOOL_CALL_TIMEOUT_MS, injected into src/domain/chat's turn. See
// timeouts.mjs's doc comment for the full ordering invariant and why each
// layer must exceed the one it wraps.

// Debounce window for `document.modelContext.ontoolchange` — confirmed
// (decisions/16) to fire in the ISOLATED world on both `registerTool()` and
// abort-driven unregistration. A page that registers several tools in a
// tight loop (or aborts several at once) can fire this repeatedly in the
// same tick; coalesce into a single `getTools()` + a single push to the
// worker.
const TOOLCHANGE_DEBOUNCE_MS = 100;

/**
 * Settle time for `document.selectionchange` before the relay considers the
 * selection final enough to tell the panel about (card 129).
 *
 * 150ms, and deliberately at the SHORT end of the range this could sensibly
 * take. `selectionchange` fires continuously while a mouse is dragged and on
 * every shift+arrow keystroke, so some settle time is required — but the
 * thing being kept in step is a chip the user is looking at while they select
 * (the Gemini-panel behaviour Jonathan asked for), and a lag long enough to
 * notice reads as the feature being broken. 150ms is under the ~200ms
 * threshold where a UI response stops feeling immediate, and comfortably
 * longer than the interval between repeats of a held-down arrow key
 * (~30-50ms), so extending a selection with the keyboard produces ONE ping
 * when the user stops, not one per character.
 */
const SELECTION_DEBOUNCE_MS = 150;

// TODO: clean-code - 0.3 - DRY: this isRecord predicate is reimplemented independently seven times across src/ (chrome-storage/area.ts, chrome-runtime/protocol.ts, mcp/json-rpc.ts, ollama/client.ts, openai/index.ts, sidepanel/presentation/untrustedJson.ts). Card 96 took it from ten: sw.ts's two message guards now reuse chrome-runtime/protocol.ts's own isRuntimeMessage, and the three tool-inspector components share sidepanel/presentation/untrustedJson.ts. The five that remain are held apart by adapters-do-not-import-adapters (each adapter stack would have to reach into another's folder) — collapsing them needs a home in src/domain, which is a decision record, not a drive-by.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}

/**
 * `@mcp-b/webmcp-types@4`'s `ModelContextToolInfo` (the element type
 * `getTools()` resolves to) has no `annotations` field at all — but Chrome
 * actually returns one. decisions/16/17 measured `getTools()` on real Chrome
 * 151/152 returning exactly `{ readOnlyHint, untrustedContentHint }` per
 * tool. This is a gap in the package's types (see
 * boards/project-backlog/42-adopt-official-webmcp-packages.md's own findings
 * comment), not a Chrome behaviour worth casting to `any` at every call
 * site — extend the type once, here, instead.
 */
interface NativeToolInfo extends ModelContextToolInfo {
  annotations?: ToolAnnotations;
}

function callWithTimeout<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms running the tool.`));
    }, timeoutMs);

    factory().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(describeError(err)));
      },
    );
  });
}

// ---------------------------------------------------------------------------
// document.modelContext availability
//
// WebMCP is off by default in Chrome (decisions/16): no
// `--enable-features=WebMCP`, no `chrome://flags/#enable-webmcp-testing`, and
// no per-origin origin-trial token means `document.modelContext` is
// `undefined`. That must produce a DISTINCT, actionable state from "the
// browser supports WebMCP and this particular page just has zero tools" —
// see `RuntimeToolsUpdatedMessage.available` in src/infra/chrome-runtime/protocol.ts. Read
// once at module load: an origin-trial token is evaluated at parse time and
// the feature flag doesn't change mid-page-lifetime, so there's nothing to
// re-check later.
const modelContext: typeof document.modelContext | undefined = document.modelContext;
const MODEL_CONTEXT_AVAILABLE = modelContext !== undefined && modelContext !== null;

if (!MODEL_CONTEXT_AVAILABLE) {
  console.debug(
    "[webmcp][relay] document.modelContext is unavailable on this page — WebMCP is off in this " +
      "browser, or this origin has no origin-trial token. Reporting available:false rather than an " +
      "empty tool list.",
  );
}

// ---------------------------------------------------------------------------
// Outgoing to the service worker (relay -> worker)
// ---------------------------------------------------------------------------

function sendRuntimeMessage(msg: RuntimeMessage): void {
  try {
    chrome.runtime.sendMessage(msg).catch((err: unknown) => {
      console.debug(
        "[webmcp][relay] runtime message not delivered (worker may be asleep or not listening yet)",
        msg.type,
        err,
      );
    });
  } catch (err) {
    console.debug("[webmcp][relay] failed to send runtime message", msg.type, err);
  }
}

function safeRespond(
  sendResponse: (response: RuntimeMessage) => void,
  response: RuntimeMessage,
): void {
  try {
    sendResponse(response);
  } catch (err) {
    console.debug("[webmcp][relay] sendResponse failed (message channel likely closed)", err);
  }
}

// ---------------------------------------------------------------------------
// Tool list cache — the live objects `getTools()` returned, keyed by name, so
// a worker-initiated `executeTool` call by name can be resolved back to the
// object the native API requires (decisions/16: `executeTool` takes the
// `ModelContextToolInfo` object, not a name).
// ---------------------------------------------------------------------------

// TODO: clean-code - 0.15 - COUPLING: module-level mutable cache/timer read and written from refreshTools, resolveTool, handleCallTool, handleRefreshToolsRequest, the ontoolchange handler and the pageshow listener. Root-owned singleton state (relay.ts is a composition root) with a well-documented lifecycle, so kept low severity.
let latestByName = new Map<string, NativeToolInfo>();
let latestSerialized: SerializedTool[] = [];

/** Strip a value down to something JSON-safe, or `undefined` if it can't be. */
function safeJson<T>(v: unknown): T | undefined {
  if (v === undefined) return undefined;
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return undefined;
    // CAST: `JSON.parse` is typed `any` and this function's `T` is the
    // CALLER's claim about the shape, not something checkable here — the
    // round trip only proves the value is JSON-representable. Every call site
    // passes a `T` it has already validated or is about to (the protocol
    // guards in ./protocol and sw.ts), so the assertion carries the caller's
    // claim across the serialisation rather than inventing one.
    return JSON.parse(s) as T;
  } catch (err) {
    console.warn("[webmcp][relay] dropping non-JSON-serialisable value", v, err);
    return undefined;
  }
}

/**
 * `ModelContextToolInfo.inputSchema` is a JSON STRING, not an object
 * (decisions/16) — parsed defensively since it's page-supplied and may be
 * absent or malformed.
 */
function parseInputSchema(
  raw: string | undefined,
  toolName: string,
): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch (err) {
    console.warn(
      `[webmcp][relay] tool "${toolName}" has a malformed inputSchema JSON string; dropping it`,
      err,
    );
    return undefined;
  }
}

/**
 * Builds the JSON-safe {@link SerializedTool} that crosses to the service
 * worker. Deliberately does NOT copy `window` — `ModelContextToolInfo.window`
 * is a live `Window` reference and is not structured-cloneable
 * (decisions/16); this function simply never reaches for it.
 */
function serialize(tool: NativeToolInfo): SerializedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: parseInputSchema(tool.inputSchema, tool.name),
    annotations: safeJson<ToolAnnotations>(tool.annotations),
  };
}

function buildToolsUpdatedMessage(): RuntimeToolsUpdatedMessage {
  return {
    type: "runtime:tools-updated",
    // A content script cannot learn its own tab id from any chrome.* API —
    // that's simply not exposed here. The worker MUST read `sender.tab.id`
    // off the chrome.runtime.onMessage callback for this message (which
    // Chrome always populates correctly for a message from a content
    // script) rather than trusting this field's value.
    tabId: -1,
    origin: location.origin,
    available: MODEL_CONTEXT_AVAILABLE,
    tools: latestSerialized,
  };
}

/** Re-reads `document.modelContext.getTools()`, refreshes the cache, and pushes the result to the worker. No-op (leaves the "unavailable" cache in place) when the feature itself is off. */
async function refreshTools(): Promise<void> {
  if (!MODEL_CONTEXT_AVAILABLE || !modelContext) return;

  // CAST: the ambient `document.modelContext` typings (src/ui/webmcp.d.ts)
  // declare `getTools()` loosely because it is a native WebIDL surface we do
  // not own and Chrome ships it unversioned. `NativeToolInfo` is this
  // module's own record of the shape decisions/16 pinned against real Chrome
  // for Testing; nothing downstream trusts it blind — `serializeTool` reads
  // every field defensively and `safeJson`s the schema.
  const raw = (await modelContext.getTools()) as NativeToolInfo[];
  // Scope to tools registered by THIS frame's own document — see the module
  // doc comment (`t.window === window`, matching the official inspector).
  // This relay only runs in the top frame anyway (`all_frames: false`), so
  // this both keeps the by-name lookup unambiguous and keeps subframe tools
  // (if Chrome ever surfaces any here) out of the list the panel shows.
  const ownFrame = raw.filter((t) => t.window === window);
  latestByName = new Map(ownFrame.map((t) => [t.name, t]));
  latestSerialized = ownFrame.map(serialize);
  sendRuntimeMessage(buildToolsUpdatedMessage());
}

/**
 * Resolves a tool NAME (what the worker calls with) to the live
 * `ModelContextToolInfo` OBJECT `executeTool` requires. Re-fetches once on a
 * cache miss — the page may have registered this tool after our last
 * `getTools()`, and `ontoolchange` is debounced — before giving up
 * (decisions/16, card 43).
 */
async function resolveTool(name: string): Promise<NativeToolInfo | undefined> {
  const cached = latestByName.get(name);
  if (cached) return cached;

  try {
    await refreshTools();
  } catch (err) {
    console.warn(`[webmcp][relay] resolveTool("${name}"): refresh after cache miss failed`, err);
  }
  return latestByName.get(name);
}

// ---------------------------------------------------------------------------
// Handling a worker-initiated tool call
// ---------------------------------------------------------------------------

/**
 * Calls `executeTool`, matching the official inspector's own handling of
 * Chrome's mid-migration argument shape (beaufortfrancois/
 * model-context-tool-inspector, content.js:41-49, v1.9.14): try the OBJECT
 * form first, and fall back to the JSON-STRING form ONLY when that throws
 * with a message starting "Failed to parse input" — Chrome's exact wording
 * when it still wants the old string form (decisions/16 measured this
 * against Chrome 151/152). Anything else is a real tool error, and is
 * RETURNED as one rather than re-thrown.
 *
 * Card 95 (decisions/34-errors-as-values.md) is what changed that last part.
 * The `throw err;` this replaces was the only entry left on
 * scripts/throw-allowlist.json that did not assert an invariant: a page tool
 * failing is the most ordinary expected outcome there is, and the rethrow was
 * only ever plumbing to carry it out through `callWithTimeout`'s promise into
 * `handleCallTool`'s catch — which mapped it straight back into a value
 * (`{ok:false, error}`). Returning the tuple says the same thing in the
 * signature, and the two-attempt shape is now visible instead of hidden in a
 * control-flow rethrow.
 *
 * The `catch` itself stays, and belongs here: this is the platform boundary,
 * where a native WebIDL call's exception becomes a value. It is the only
 * thing this function catches, and it catches it in one statement.
 */
async function callExecuteTool(
  mc: NonNullable<typeof modelContext>,
  tool: NativeToolInfo,
  args: Record<string, unknown>,
): Promise<Result<string | null, Error>> {
  try {
    // `@mcp-b/webmcp-types@4` only declares the JSON-string form (matching
    // decisions/16's current measurement) — this object-form attempt is
    // intentionally ahead of those types, hence the narrow cast. Called
    // through `.call(mc, ...)` rather than detached into a bare reference:
    // `executeTool` is a native WebIDL method and Chrome throws
    // `Illegal invocation` if it's invoked with any receiver other than the
    // `ModelContext` instance itself — confirmed against real Chrome for
    // Testing 152.0.7977.54 while building the verify harness (card 46).
    const executeWithObject = mc.executeTool as unknown as (
      t: NativeToolInfo,
      a: Record<string, unknown>,
    ) => Promise<string | null>;
    return ok(await executeWithObject.call(mc, tool, args));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Failed to parse input")) {
      // The retry is NOT wrapped: a failure of the string form is this
      // function's own terminal outcome, and `handleCallTool`'s boundary
      // catch (which already has to exist for the timeout) reports it.
      return ok(await mc.executeTool(tool, JSON.stringify(args)));
    }
    return fail(err instanceof Error ? err : new Error(describeError(err)));
  }
}

async function handleCallTool(
  req: RuntimeCallToolRequest,
  sendResponse: (response: RuntimeMessage) => void,
): Promise<void> {
  if (!MODEL_CONTEXT_AVAILABLE || !modelContext) {
    safeRespond(sendResponse, {
      type: "runtime:call-tool-response",
      ok: false,
      error: "WebMCP is not available on this page (document.modelContext is undefined).",
    });
    return;
  }
  const mc = modelContext;

  const tool = await resolveTool(req.name);
  if (!tool) {
    safeRespond(sendResponse, {
      type: "runtime:call-tool-response",
      ok: false,
      error: `Unknown tool: "${req.name}"`,
    });
    return;
  }

  const args = isRecord(req.args) ? req.args : {};

  // The `try` is the TIMEOUT's boundary, not the tool's: `callWithTimeout`
  // rejects when the inner call outruns RELAY_EXECUTE_TIMEOUT_MS (and if the
  // string-form retry inside `callExecuteTool` throws). The tool's own failure
  // arrives as `execErr` below — a value, since card 95.
  try {
    const [resultJson, execErr] = await callWithTimeout(
      () => callExecuteTool(mc, tool, args),
      RELAY_EXECUTE_TIMEOUT_MS,
    );
    if (execErr) {
      safeRespond(sendResponse, {
        type: "runtime:call-tool-response",
        ok: false,
        error: describeError(execErr),
      });
      return;
    }

    // executeTool resolves to a nullable JSON string (decisions/16) — parse
    // it, and pass `null` straight through rather than trying to JSON.parse
    // it.
    let result: unknown = null;
    if (resultJson !== null && resultJson !== undefined) {
      try {
        result = JSON.parse(resultJson);
      } catch (err) {
        console.warn(
          `[webmcp][relay] executeTool("${req.name}") returned a non-JSON string; passing it through raw`,
          err,
        );
        result = resultJson;
      }
    }

    safeRespond(sendResponse, { type: "runtime:call-tool-response", ok: true, result });
  } catch (err) {
    safeRespond(sendResponse, {
      type: "runtime:call-tool-response",
      ok: false,
      error: describeError(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Handling the worker's rebuild-on-restart pull
//
// Unlike the old bridge-relay round trip (a CustomEvent to another JS world,
// which might not have installed yet), `document.modelContext.getTools()` is
// directly awaitable at any time — there's no "hasn't announced yet" state to
// wait out any more, so this is just a fetch-and-respond.
// ---------------------------------------------------------------------------

async function handleRefreshToolsRequest(
  sendResponse: (response: RuntimeMessage) => void,
): Promise<void> {
  if (MODEL_CONTEXT_AVAILABLE) {
    try {
      await refreshTools();
    } catch (err) {
      console.warn("[webmcp][relay] refresh-tools: getTools() failed", err);
    }
  }
  safeRespond(sendResponse, buildToolsUpdatedMessage());
}

// ---------------------------------------------------------------------------
// Handling a page-context pull (card 118, decisions/40-page-context-access.md)
//
// The relay is the ONLY code in this extension with a visited page's DOM in
// scope, and decisions/40 keeps it that way: the panel never touches a page,
// it asks for a snapshot and gets plain text back.
//
// Note what is NOT here. There is no `MutationObserver`, no cached
// last-selection TEXT, and no unsolicited push of page content to the worker.
// A snapshot is produced only when a `runtime:get-page-context` request
// arrives — which the panel only ever sends on a user gesture, or on the
// content-free ping below — so nothing about a page leaves it without the
// user having done something to ask for that (decisions/40's privacy
// posture, amending docs/03).
//
// Card 129 added the ONE thing this comment used to also rule out: a
// `selectionchange` listener. It does not read page text out to anyone — see
// "Live selection pings" at the bottom of this file for what it does and what
// it deliberately cannot do.
//
// Synchronous and unwrapped by `callWithTimeout`, unlike a tool call: both
// reads are bounded by construction (`PAGE_EXTRACT_CAP_BYTES` and the walk's
// own node ceiling, src/infra/dom/page-extraction.ts) and neither can await
// anything page-authored, so there is nothing here for a timeout to rescue.
// The worker still applies SW_PAGE_CONTEXT_TIMEOUT_MS on its side, which
// covers the case this file cannot: a page whose main thread is wedged so
// hard that this listener never runs at all.
// ---------------------------------------------------------------------------

function buildPageContext(mode: RuntimeGetPageContextRequest["mode"]): PageContextSnapshot {
  const extracted =
    mode === "selection"
      ? extractSelection(document, PAGE_EXTRACT_CAP_BYTES)
      : extractPageText(document, PAGE_EXTRACT_CAP_BYTES);
  // Diagnostic breadcrumb (2026-08-23, "still no chip"): shows in the PAGE
  // tab's console. If a selection pull reaches this relay at all, this line
  // says so and says what it read. Card 128 formalizes/retires it.
  console.info(
    `[openchat:relay] ${mode} pull → ${extracted.bytes} bytes` +
      (mode === "selection" && extracted.bytes === 0 ? " (no selection found)" : ""),
  );

  return {
    mode,
    text: extracted.text,
    // Read at extraction time, alongside the text, and never re-read later:
    // a snapshot is a value, and the page it names must be the page the text
    // came from even if the tab navigates a moment afterwards.
    url: location.href,
    title: document.title,
    truncated: extracted.truncated,
    bytes: extracted.bytes,
  };
}

function handleGetPageContext(
  req: RuntimeGetPageContextRequest,
  sendResponse: (response: RuntimeMessage) => void,
): void {
  safeRespond(sendResponse, {
    type: "runtime:get-page-context-response",
    tabId: req.tabId,
    ok: true,
    restricted: false,
    context: buildPageContext(req.mode),
  });
}

// ---------------------------------------------------------------------------
// chrome.runtime.onMessage: worker -> relay
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return false;

  if (message.type === "runtime:call-tool") {
    void handleCallTool(message, sendResponse);
    return true; // keep the channel open for the async response
  }

  if (message.type === "runtime:refresh-tools") {
    void handleRefreshToolsRequest(sendResponse);
    return true;
  }

  if (message.type === "runtime:get-page-context") {
    // Answered SYNCHRONOUSLY — `sendResponse` has already been called by the
    // time this returns, so the channel does not need to stay open and this
    // returns `false`, not `true`. (Returning `true` here would be harmless
    // but wrong: it tells Chrome to keep a port alive for a reply that has
    // already been sent.)
    handleGetPageContext(message, sendResponse);
    return false;
  }

  // Not ours (e.g. runtime:get-tools is answered by the worker itself).
  return false;
});

// ---------------------------------------------------------------------------
// document.modelContext.ontoolchange — live updates
// ---------------------------------------------------------------------------

let toolchangeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleToolsRefresh(): void {
  if (toolchangeTimer !== undefined) clearTimeout(toolchangeTimer);
  toolchangeTimer = setTimeout(() => {
    toolchangeTimer = undefined;
    refreshTools().catch((err) => console.warn("[webmcp][relay] ontoolchange refresh failed", err));
  }, TOOLCHANGE_DEBOUNCE_MS);
}

if (MODEL_CONTEXT_AVAILABLE && modelContext) {
  modelContext.ontoolchange = scheduleToolsRefresh;
}

// ---------------------------------------------------------------------------
// Live selection pings (card 129, decisions/40's "Live chip updates")
//
// The composer's selection chip is meant to track the page the way Gemini's
// panel does: highlight something, and the chip is already showing it — no
// click into the panel first. That needs the page to say when its selection
// moved, because the panel has no way to observe a document it is forbidden
// to touch.
//
// WHAT CROSSES: a `runtime:selection-changed` message with no payload beyond
// the tab-id sentinel. Not the text, not its length, not a preview. The panel
// answers it by making the SAME gated pull it makes on a user gesture, so
// page text still travels on exactly one message (`runtime:get-page-context`)
// and still only when the sharing gate is up. A dismissed gate turns the ping
// into a no-op in the panel — the relay is not told about the gate, and must
// not be: a content script's knowledge of the user's consent state would be
// one more thing to keep in step and one more thing a page could infer.
//
// WHEN IT FIRES: once per SETTLED CHANGE. `selectionchange` fires on every
// mousemove of a drag and every keystroke of a shift+arrow extension; those
// are debounced into one ({@link SELECTION_DEBOUNCE_MS}), and then dropped
// entirely unless the settled selection's fingerprint differs from the last
// one reported. That second half is what keeps a click that merely collapses
// a caret — or a page that re-applies the same selection programmatically —
// from waking the worker and the panel for nothing.
//
// `selectionIdentity` (src/infra/dom/page-extraction.ts) is derived from the
// same extraction the pull performs, so the ping and the chip can never
// disagree about what counts as a selection: a two-character one is below
// MIN_SELECTION_CHARS, reads as no selection, and produces no ping.
//
// Form controls are covered here without a second listener: Chrome fires
// `selectionchange` on the DOCUMENT for `<input>`/`<textarea>` selections
// too, and `selectionIdentity` reads those through the same
// `formControlSelection` path `extractSelection` uses (passwords excluded).
// ---------------------------------------------------------------------------

let selectionTimer: ReturnType<typeof setTimeout> | undefined;
/** Fingerprint of the last selection reported to the worker — never the text itself. `""` means "nothing worth offering", which is also the state at load. */
let lastSelectionIdentity = "";

function notifySelectionIfChanged(): void {
  const identity = selectionIdentity(document);
  if (identity === lastSelectionIdentity) return;
  lastSelectionIdentity = identity;
  // Sent even when the selection has just become EMPTY (identity ""), so a
  // chip for a selection the user has cleared goes away on its own rather
  // than lingering until the next gesture. The pull that follows comes back
  // empty, which the panel already treats as "nothing to offer".
  sendRuntimeMessage({ type: "runtime:selection-changed", tabId: -1 });
}

document.addEventListener("selectionchange", () => {
  if (selectionTimer !== undefined) clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    selectionTimer = undefined;
    notifySelectionIfChanged();
  }, SELECTION_DEBOUNCE_MS);
});

// ---------------------------------------------------------------------------
// Lifecycle: startup, bfcache restore
// ---------------------------------------------------------------------------

if (MODEL_CONTEXT_AVAILABLE) {
  refreshTools().catch((err) => console.warn("[webmcp][relay] initial getTools() failed", err));
} else {
  // Nothing to fetch — push the "unavailable" state up front so the worker's
  // registry (and any panel already open) learn it immediately rather than
  // discovering it only when something tries to call a tool.
  sendRuntimeMessage(buildToolsUpdatedMessage());
}

// Coming back from bfcache: the page (and its live tool registrations)
// survived, but the worker may have discarded anything it knew about this
// tab in the meantime. Re-fetch so it catches up.
window.addEventListener("pageshow", (event) => {
  if (event.persisted && MODEL_CONTEXT_AVAILABLE) {
    refreshTools().catch((err) =>
      console.warn("[webmcp][relay] bfcache-restore refresh failed", err),
    );
  }
});
