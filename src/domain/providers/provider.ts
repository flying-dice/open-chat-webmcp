// The provider-agnostic chat contract every concrete client (Ollama, OpenAI,
// future providers) implements (decisions/09-provider-agnostic-chat-transport.md,
// decisions/11-provider-capability-detection.md). This file is the shared
// vocabulary cards 21 (OpenAI), 22 (provider registry UI), and 23 (panel
// picker) all code against.
//
// It is deliberately designed against OpenAI's wire format — SSE, per-call
// ids the caller must echo back, bearer auth that can 401, no per-model
// capability endpoint — as the harder case. Ollama's client
// (src/infra/ollama/adapter.ts, adapting the raw REST client in
// src/infra/ollama/client.ts) is the one that bends to fit this shape; nothing here
// leaks NDJSON, Ollama's id-less tool calls, or Ollama's auth-free requests.
//
// Never-throw discipline (carried forward from src/infra/ollama/client.ts, which
// predates this file): every method here returns a `Result<T, ProviderError>`
// for a one-shot call, or yields a terminal `{ type: "error" }` stream event
// for `chat`, instead of throwing. A client that hits a failure mode not
// covered by `ProviderError` should widen that union in an additive change,
// never throw a bespoke error to route around it.
//
// Card 93 (decisions/34-errors-as-values.md) replaced this file's own
// `ProviderResult<T>` record (`{ok: true, value} | {ok: false, error}`) with
// the shared tuple in src/domain/result.ts. Same never-throw contract, one
// shape across the whole repo — see `ChatStreamEvent` below for how the
// STREAMING half of the contract delivers the same `ProviderError`, and why
// it is an event rather than a `Result`.

// Card 73 (decisions/29) moved this file from src/lib/provider.ts into the
// `providers` bounded context. Its one cross-context dependency —
// `SerializedTool`, the shape `chat()` takes tool definitions in — now comes
// from the `tools` context's BARREL rather than from the `chrome.runtime`
// messaging adapter that used to declare it (src/lib/protocol.ts, now
// src/infra/chrome-runtime/protocol.ts). Contexts
// plug together through barrels, never by reaching into each other's files.
import type { Result } from "../result";
import type { SerializedTool } from "../tools";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Discriminant for which wire client backs a `ChatProvider`. Extend
 * additively as new clients are built — card 21 is expected to add
 * `"openai"`'s implementation behind the value already declared here.
 */
export type ProviderType = "ollama" | "openai";

/**
 * The base URL an `openai`-type config falls back to when it doesn't set one.
 *
 * A DOMAIN constant rather than an adapter one (card 78): the options page's
 * provider form pre-fills the field with it while the user is still deciding
 * what to register, which is well before any wire client exists — and a form
 * reaching into src/infra/openai for one string was the last thing keeping
 * `ui-does-not-import-infra` from holding. `baseUrl` is the HOST only: every
 * request path appends its own `/v1/...` suffix (the same convention Ollama's
 * client uses for `/api/...`), so an OpenAI-compatible host — OpenRouter's
 * `https://openrouter.ai/api`, a local proxy — works by pointing this at that
 * host, never at a pre-built `/v1/chat/completions` URL. src/infra/openai
 * reads it from here.
 */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

// ---------------------------------------------------------------------------
// Custom request headers (decisions/15-custom-headers-are-credentials.md)
// ---------------------------------------------------------------------------

/**
 * One user-defined request header attached to a provider config. `value` is
 * a credential by default (decision 15) — the same treatment as `apiKey`:
 * stored in `chrome.storage.local` only (src/infra/chrome-storage/provider-registry.ts),
 * masked in the options UI (src/options/components/ProviderForm.svelte),
 * and never written into an error message, the call log, or the inspector.
 */
export interface ProviderHeader {
  key: string;
  value: string;
}

/**
 * Why a candidate header name is reserved — a discriminant for which rule
 * tripped, plus the canonical header name as data (card 107,
 * decisions/37-i18n-paraglide.md). Domain layer, so no English here: a UI
 * surface renders this via `src/ui/reservedHeaderMessage.ts`'s
 * `providerReservedHeaderMessage`, the same code/copy split
 * `src/ui/providerMessage.ts` established for `ProviderError`.
 */
export type ReservedHeaderReason =
  | { kind: "content-type"; header: string }
  | { kind: "accept"; header: string }
  | { kind: "authorization-api-key"; header: string };

/**
 * Whether `name` is a header a `ChatProvider` client controls for
 * correctness and a user-defined header (decision 15) can therefore never
 * override — checked case-insensitively, since HTTP header names are.
 * Returns the {@link ReservedHeaderReason} to show inline at edit time when
 * reserved, `undefined` when the name is free to use.
 *
 * - `Content-Type` is reserved for every provider type: both clients
 *   (src/infra/ollama/client.ts, src/infra/openai) always send JSON
 *   bodies and depend on this value being exactly right.
 * - `Accept` is reserved for `"openai"` only — that client sets it per
 *   request (`application/json` for `listModels`, `text/event-stream` for
 *   `chat`'s SSE stream); Ollama's client never sets it, so there is nothing
 *   for a custom value to conflict with.
 * - `Authorization` is reserved for `"openai"` only, and only while
 *   `apiKeyConfigured` — decision 15's "exactly one thing controls it":
 *   OpenAI's client sends `Authorization: Bearer <apiKey>` when a key is
 *   set, so a custom value would silently lose to it. Ollama has no API-key
 *   concept at all, so `Authorization` is always free there — useful for a
 *   gateway sitting in front of a local Ollama server.
 */
// TODO: clean-code - 0.5 - DRY: an independent, unlinked implementation of "which header names are reserved" from src/domain/tools/servers.ts's validateServerHeaders/CLIENT_CONTROLLED_HEADERS — one returns an issue array for MCP servers, this returns a single reason value for providers, with no shared source tying the rule together.
export function reservedHeaderReason(
  name: string,
  opts: { type: ProviderType; apiKeyConfigured: boolean },
): ReservedHeaderReason | undefined {
  const lower = name.trim().toLowerCase();
  if (lower.length === 0) return undefined;

  if (lower === "content-type") {
    return { kind: "content-type", header: "Content-Type" };
  }
  if (opts.type === "openai" && lower === "accept") {
    return { kind: "accept", header: "Accept" };
  }
  if (opts.type === "openai" && lower === "authorization" && opts.apiKeyConfigured) {
    return { kind: "authorization-api-key", header: "Authorization" };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Errors / results
// ---------------------------------------------------------------------------

/**
 * A discriminated error every provider client reports through — never
 * throws. Ollama only ever produces a subset of these (it has no `"auth"`
 * case: no concept of authentication). OpenAI is the case that motivates the
 * two kinds Ollama never needs:
 *   - `"auth"`: a 401 on a missing/invalid bearer key.
 *   - `"not-supported"`: no `/v1/models`-equivalent on some OpenAI-compatible
 *     hosts, so `listModels` can't be fulfilled — callers should fall back to
 *     a user-entered model id rather than treating this as a hard failure.
 */
export type ProviderError =
  | {
      kind: "unreachable-or-cors";
      message: string;
      /**
       * A concrete, copy-pasteable fix for this specific failure — e.g.
       * Ollama's client (src/infra/ollama/client.ts) fills this in with the exact
       * `OLLAMA_ORIGINS` assignment (boards/project-backlog/14-connection-diagnostics-and-empty-states.md:
       * "the message must name this possibility explicitly... make the fix
       * copyable"). `undefined` when there's no single command to hand back
       * (e.g. OpenAI's fix is "grant a host permission on the options
       * page", a UI action, not a shell command). UI built on this should
       * render `command` verbatim, not paraphrase it — a copy button only
       * helps if what it copies is exactly what the user needs to run.
       */
      fix?: { label: string; command: string };
    }
  | { kind: "aborted" }
  | { kind: "auth"; status: number; message: string }
  | { kind: "http"; status: number; statusText: string; body?: string }
  | { kind: "not-supported"; message: string }
  | { kind: "invalid-response"; message: string };

/**
 * Ready-made ENGLISH copy for a {@link ProviderError} — the single source of
 * the sentence shape for the two DOMAIN-INTERNAL consumers that render it
 * into a place a person reads without going through a UI layer at all:
 * `src/domain/chat/turn.ts`'s terminal-error transcript message, and
 * `resolveCapability` below (via `src/domain/providers/capability.ts`,
 * `ModelCapabilities.detail`) as the fallback evidence for an unreachable
 * provider's capability check. Both are pre-existing, larger-scope English
 * debt outside this card's remit (card 101's journal names `turn.ts`
 * explicitly; `resolveCapability`'s use is the same class of issue one hop
 * removed) — deliberately left calling this domain-side function UNCHANGED,
 * rather than broken by moving it, so this card's fix does not silently
 * widen turn.ts's scope.
 *
 * UI CODE THAT WANTS LOCALIZED COPY FOR THE SAME {@link ProviderError} MUST
 * NOT CALL THIS. Card 102 (decisions/37-i18n-paraglide.md) added
 * `src/ui/providerMessage.ts`'s own `describeProviderError` — the same
 * switch, translated via Paraglide — for exactly that: the side panel's
 * `stores/selection.svelte.ts` and the options page's
 * `ProvidersSection.svelte` both import the UI-side one now. Two
 * implementations of the same shape is the accepted cost of decisions/34's
 * "error copy stays out of the domain layer" rule meeting two pre-existing
 * domain-internal consumers this card was told not to touch — a future card
 * that also tackles `turn.ts`'s own larger-scope strings could fold this one
 * away by having `ModelCapabilities` carry the raw `ProviderError` instead of
 * pre-rendered `detail` text, and giving `turn.ts` a UI-independent way to
 * report a terminal failure.
 */
export function describeProviderError(error: ProviderError): string {
  switch (error.kind) {
    case "unreachable-or-cors":
      return error.message;
    case "aborted":
      return "Request was cancelled.";
    case "auth":
      return `Authentication failed (${error.status}): ${error.message}`;
    case "http":
      return `Provider returned ${error.status} ${error.statusText}${
        error.body ? `: ${error.body}` : ""
      }`;
    case "not-supported":
      return error.message;
    case "invalid-response":
      return `Provider returned something this extension couldn't understand: ${error.message}`;
  }
}

// NO `ProviderResult<T>` ALIAS (card 93). A non-streaming call delivers this
// vocabulary as the shared `Result<T, ProviderError>` (src/domain/result.ts)
// and nothing else: decisions/34 asks for ONE result shape across the repo,
// and a per-context alias over it is a second name for the same thing that
// call sites then have to translate between. Spelling the vocabulary out at
// every signature is also what makes the MIXED sites readable — a component
// holding a `StorageError` from the registry and a `ProviderError` from the
// client in the same function now says which is which.

// ---------------------------------------------------------------------------
// Models & capabilities (decisions/11-provider-capability-detection.md)
// ---------------------------------------------------------------------------

/** A model as offered by a provider, narrowed to what every client can supply. */
export interface ProviderModel {
  /** Identifier passed back into `chat({model})` / `getCapabilities(model)` — Ollama's tag name, OpenAI's model id, etc. */
  id: string;
  /** Display label. Equal to `id` for providers with no separate display name. */
  name: string;
  /**
   * Opaque cache key for {@link ChatProvider.getCapabilities}, when the
   * provider has one — Ollama's content digest, which changes on re-pull and
   * is what its capability cache is keyed by. Providers with no such concept
   * (OpenAI) omit it; their client caches (if at all) by `id` instead.
   */
  cacheKey?: string;
}

/**
 * Tool-calling support for a model — three states, not a boolean, so
 * "unverified" never collapses into "safe" or "unsafe" (decisions/11).
 *
 * - `"tool-capable"` / `"no-tools"`: the provider has a definitive answer
 *   (Ollama's live `/api/show`, or a model on OpenAI's maintained allowlist).
 * - `"unknown"`: the provider cannot say — the common case is an OpenAI
 *   model not on the static allowlist. Must stay visually and semantically
 *   distinct from `"no-tools"` in any UI built on this (card 23): silently
 *   treating "unverified" as "safe" is exactly the failure decision 11 (and
 *   the decision 06 it supersedes) was written to prevent.
 */
export type ToolCapabilityStatus = "tool-capable" | "no-tools" | "unknown";

/** Result of a tool-capability check for one model. */
export interface ModelCapabilities {
  status: ToolCapabilityStatus;
  /**
   * Free-form evidence for `status`, for an inline UI reason — Ollama's raw
   * `/api/show` `capabilities` array, or a one-line note like "not on the
   * OpenAI tool-calling allowlist". Omitted when there's nothing to show.
   */
  detail?: string[];
}

// ---------------------------------------------------------------------------
// Chat messages & streaming (decisions/09)
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * A tool call requested by the model, always carrying an `id` — OpenAI
 * assigns one on the wire and requires it to correlate a later `role:"tool"`
 * result; Ollama assigns none, so its client (src/infra/ollama/adapter.ts,
 * via src/infra/ollama/client.ts's stream parser) synthesizes a stable one per call.
 * Callers never need to special-case an absent id.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set on an assistant message that requested tool calls. */
  toolCalls?: ToolCall[] | undefined;
  /**
   * Set on a `role:"tool"` message: which call this answers (matches a
   * {@link ToolCall.id}). Required on the wire for OpenAI; Ollama's client
   * ignores it when sending, since Ollama has no call ids to correlate.
   */
  toolCallId?: string | undefined;
  /**
   * Set on a `role:"tool"` message: the tool's name. Ollama's `/api/chat`
   * wants this on the tool message; OpenAI infers it from `toolCallId` and
   * its client ignores this field when sending.
   */
  toolName?: string | undefined;
}

/**
 * Final generation stats, present on the terminal `"done"` stream event.
 * Every field is optional because no two providers report the same set.
 */
export interface ChatStats {
  doneReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  /**
   * Provider-specific extras (e.g. Ollama's duration breakdown) surfaced
   * as-is for diagnostics. Not for cross-provider logic — branch on the
   * typed fields above instead.
   */
  raw?: Record<string, unknown>;
}

/**
 * One event out of {@link ChatProvider.chat}'s stream. A tagged union (not a
 * callback per kind) so an agent loop can drive it with a single
 * `for await` + `switch`, the same shape src/infra/ollama/client.ts already used.
 *
 * STREAMING FAILURES ARE EVENTS, NOT `Result`s (card 93, decisions/34).
 * `chat` is the one member of this contract whose failures are NOT delivered
 * as `Result<T, ProviderError>`, and the reason is that a stream has already
 * produced OUTPUT by the time most of its failures happen. Three shapes were
 * on the table:
 *
 *  1. `AsyncGenerator<Result<ChatStreamEvent, ProviderError>>` — every
 *     consumer unwraps a tuple on every content delta, thousands of times per
 *     turn, to express something that can happen at most once.
 *  2. `Promise<Result<AsyncGenerator<…>, ProviderError>>` — puts SETUP
 *     failures (unreachable, 401, 404) in the return type but leaves
 *     MID-STREAM ones (abort, malformed NDJSON/SSE, a connection that closed
 *     before `done:true`) with nowhere to go, so the caller would need two
 *     failure paths for one vocabulary.
 *  3. This one: the generator never rejects, and every failure — setup or
 *     mid-stream — arrives as a single terminal `{type:"error", error}`
 *     carrying the same typed `ProviderError` a one-shot call would have
 *     returned, after which the generator RETURNS.
 *
 * (3) is what the repo already had and what card 92 concluded should stay:
 * the error is typed and exhaustively switchable exactly like the `Result`
 * arm, the tokens already emitted before the fault stay in the transcript
 * (a truncated reply plus a stated reason, rather than a discarded turn),
 * and there is no per-delta unwrapping. The invariant a consumer may rely on
 * is: **`{type:"error"}` is terminal and at most one is emitted; nothing
 * follows it.** `src/domain/chat/turn.ts` consumes it that way, and its
 * `for await` is still wrapped in a `try` — not because a compliant client
 * can throw, but because a non-compliant one must not kill the loop.
 *
 * A failure that is NOT in `ProviderError` remains a `throw`, as everywhere
 * else in decisions/34: it is a bug, not a wire outcome.
 */
export type ChatStreamEvent =
  | { type: "content"; delta: string }
  | { type: "tool-calls"; toolCalls: ToolCall[] }
  | { type: "done"; message: ChatMessage; stats: ChatStats }
  | { type: "error"; error: ProviderError };

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  /** Page tools to offer the model; each client converts to its own wire tool-def shape. Omit or pass `[]` for no tools. */
  tools?: SerializedTool[] | undefined;
  /** Tied to the panel's lifetime — aborting mid-stream ends the generator with a terminal `{type:"error", error:{kind:"aborted"}}` event, never a throw. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Everything the side panel and agent loop need from a chat backend,
 * independent of wire format. One instance is bound to one resolved provider
 * config (base URL, API key) at construction time via the `createProviderClient`
 * a composition root's wiring builds from `createProviderClientFactory`
 * (./client-factory.ts) — methods here take no `baseUrl`/`apiKey` params.
 */
export interface ChatProvider {
  readonly type: ProviderType;

  /**
   * List models this provider currently offers. May resolve to a
   * `{ kind: "not-supported" }` error (e.g. no `/v1/models`-equivalent) —
   * callers should fall back to a user-entered model id in that case, never
   * treat it as a hard failure.
   */
  listModels(opts?: { signal?: AbortSignal }): Promise<Result<ProviderModel[], ProviderError>>;

  /** Resolve tool-calling support for one model (decisions/11). Never guesses: returns `"unknown"` rather than assuming either way when the provider can't say. */
  getCapabilities(
    model: ProviderModel,
    opts?: { signal?: AbortSignal; forceRefresh?: boolean },
  ): Promise<Result<ModelCapabilities, ProviderError>>;

  /** Stream a chat completion. Never throws — every failure, including a request-setup failure, surfaces as a single terminal `{type:"error"}` event carrying a typed {@link ProviderError}; see {@link ChatStreamEvent} for why this half of the contract is an event rather than a `Result`. */
  chat(params: ChatParams): AsyncGenerator<ChatStreamEvent, void, void>;
}
