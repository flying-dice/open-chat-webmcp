// The provider-agnostic chat contract every concrete client (Ollama, OpenAI,
// future providers) implements (decisions/09-provider-agnostic-chat-transport.md,
// decisions/11-provider-capability-detection.md). This file is the shared
// vocabulary cards 21 (OpenAI), 22 (provider registry UI), and 23 (panel
// picker) all code against.
//
// It is deliberately designed against OpenAI's wire format — SSE, per-call
// ids the caller must echo back, bearer auth that can 401, no per-model
// capability endpoint — as the harder case. Ollama's client
// (src/lib/providers/ollama.ts, adapting the raw REST client in
// src/lib/ollama.ts) is the one that bends to fit this shape; nothing here
// leaks NDJSON, Ollama's id-less tool calls, or Ollama's auth-free requests.
//
// Never-throw discipline (carried forward from src/lib/ollama.ts, which
// predates this file): every method here returns a `ProviderResult` for a
// one-shot call, or yields a terminal `{ type: "error" }` stream event for
// `chat`, instead of throwing. A client that hits a failure mode not covered
// by `ProviderError` should widen that union in an additive change, never
// throw a bespoke error to route around it.

import type { SerializedTool } from "./protocol";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Discriminant for which wire client backs a `ChatProvider`. Extend
 * additively as new clients are built — card 21 is expected to add
 * `"openai"`'s implementation behind the value already declared here.
 */
export type ProviderType = "ollama" | "openai";

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
       * Ollama's client (src/lib/ollama.ts) fills this in with the exact
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

/** Ready-made user-facing copy for a {@link ProviderError}, for UI that doesn't want to hand-roll it. */
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

/** Result of a non-streaming call: never throws, always branch on `ok`. */
export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderError };

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
 * result; Ollama assigns none, so its client (src/lib/providers/ollama.ts,
 * via src/lib/ollama.ts's stream parser) synthesizes a stable one per call.
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
  toolCalls?: ToolCall[];
  /**
   * Set on a `role:"tool"` message: which call this answers (matches a
   * {@link ToolCall.id}). Required on the wire for OpenAI; Ollama's client
   * ignores it when sending, since Ollama has no call ids to correlate.
   */
  toolCallId?: string;
  /**
   * Set on a `role:"tool"` message: the tool's name. Ollama's `/api/chat`
   * wants this on the tool message; OpenAI infers it from `toolCallId` and
   * its client ignores this field when sending.
   */
  toolName?: string;
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
 * `for await` + `switch`, the same shape src/lib/ollama.ts already used.
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
  tools?: SerializedTool[];
  /** Tied to the panel's lifetime — aborting mid-stream ends the generator with a terminal `{type:"error", error:{kind:"aborted"}}` event, never a throw. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Everything the side panel and agent loop need from a chat backend,
 * independent of wire format. One instance is bound to one resolved provider
 * config (base URL, API key) at construction time via
 * `src/lib/providers/registry.ts`'s `createProviderClient` — methods here
 * take no `baseUrl`/`apiKey` params.
 */
export interface ChatProvider {
  readonly type: ProviderType;

  /**
   * List models this provider currently offers. May resolve to a
   * `{ kind: "not-supported" }` error (e.g. no `/v1/models`-equivalent) —
   * callers should fall back to a user-entered model id in that case, never
   * treat it as a hard failure.
   */
  listModels(opts?: {
    signal?: AbortSignal;
  }): Promise<ProviderResult<ProviderModel[]>>;

  /** Resolve tool-calling support for one model (decisions/11). Never guesses: returns `"unknown"` rather than assuming either way when the provider can't say. */
  getCapabilities(
    model: ProviderModel,
    opts?: { signal?: AbortSignal; forceRefresh?: boolean },
  ): Promise<ProviderResult<ModelCapabilities>>;

  /** Stream a chat completion. Never throws — every failure, including a request-setup failure, surfaces as a terminal `{type:"error"}` event. */
  chat(params: ChatParams): AsyncGenerator<ChatStreamEvent, void, void>;
}
