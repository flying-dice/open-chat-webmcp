// Typed, UI-free REST client for a local Ollama server: model listing,
// tool-capability detection, and streaming chat. This is the raw wire-level
// client; ./adapter.ts wraps it to implement the shared `ChatProvider`
// interface (src/domain/providers/provider.ts,
// decisions/09-provider-agnostic-chat-transport.md) that OpenAI's client
// (src/infra/openai) and the registry UI/panel picker build against. This
// module stays Ollama-specific on purpose — its exported names
// (`OllamaModel`, `OllamaChatMessage`, ...) describe Ollama's wire shapes,
// not the cross-provider ones; the adapter is where the translation happens.
//
// Called directly from the side panel — the panel owns the HTTP connection
// and this module never talks to the background service worker
// (decisions/09-provider-agnostic-chat-transport.md, which supersedes
// decisions/04-ollama-transport.md). Do not add UI or DOM code here; the
// side panel Svelte app is built on top of the `ChatProvider` adapter, not
// this module directly.
//
// Error handling: nothing in this module throws bare strings, and network
// failures are never surfaced as generic "it broke" text. `listModels` and
// `getCapabilities` return a `ProviderResult<T>` the caller must branch on;
// `chat` is an async generator that yields a typed `{ type: "error" }` event
// instead of throwing, since it may already be mid-stream. `OllamaError`
// (a narrowed view of the shared `ProviderError` — Ollama has no `"auth"` or
// `"not-supported"` failure mode) names a blocked CORS preflight and a dead
// server as a shared, explicit discriminant rather than a generic network
// error (decisions/09, carried forward from decisions/04). A plain HTTP 403
// response gets the same `unreachable-or-cors` treatment — see
// `originRejectedError`'s doc comment below — instead of falling into the
// generic `"http"` kind (card 33).

import type { SerializedTool } from "../../domain/tools";
import type {
  ModelCapabilities,
  ModelCapabilityCache,
  ProviderDefaultsStore,
  ProviderError,
  ProviderHeader,
  ProviderResult,
} from "../../domain/providers";

// ---------------------------------------------------------------------------
// Configuration
//
// CARD 74 took this module's own `chrome.storage.local` store away —
// `ollama:baseUrl` and `ollama:cap:<digest>`, formerly read and written from
// the middle of this wire client. Both are now ports the caller supplies
// (`ProviderDefaultsStore`, `ModelCapabilityCache`, src/domain/providers),
// implemented by src/infra/chrome-storage and injected by whichever
// composition-root wiring builds this client (card 75:
// the `createProviderClientFactory` map in each composition root).
// Nothing below touches storage — an infra adapter importing
// src/infra/chrome-storage directly would break `adapters-do-not-import-adapters`
// (.claude/skills/ddd-hexagonal/SKILL.md), so both ports arrive here already
// resolved rather than being reached for.
// ---------------------------------------------------------------------------

/** Default Ollama base URL when nothing has been configured yet. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Resolve the base URL for a call: an explicit one wins, then whatever the
 * caller's {@link ProviderDefaultsStore} has stored for `"ollama"`, then
 * {@link DEFAULT_OLLAMA_BASE_URL}. A registry entry carries its own
 * `baseUrl` and always takes the first branch — the store is only what a
 * caller with no registry entry falls back to.
 */
async function resolveBaseUrl(
  explicit: string | undefined,
  defaults: ProviderDefaultsStore | undefined,
): Promise<string> {
  if (explicit) return explicit;
  const stored = await defaults?.getBaseUrl("ollama");
  return stored ?? DEFAULT_OLLAMA_BASE_URL;
}

// ---------------------------------------------------------------------------
// Result / error types
// ---------------------------------------------------------------------------

/**
 * The subset of the shared {@link ProviderError} union Ollama can actually
 * produce: no `"auth"` (Ollama has no concept of authentication) and no
 * `"not-supported"` (its endpoints are always either present or unreachable).
 * Structurally identical to those members of `ProviderError`, so values here
 * assign straight into it — nothing to convert at the adapter boundary.
 */
export type OllamaError = Extract<
  ProviderError,
  { kind: "unreachable-or-cors" | "aborted" | "http" | "invalid-response" }
>;

function toOllamaError(err: unknown): OllamaError {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "aborted" };
  }
  // A blocked CORS preflight and a dead server both reject fetch with a bare
  // TypeError — there is no way to distinguish them from here. Name the
  // ambiguity explicitly rather than reporting a generic network error.
  if (err instanceof TypeError) {
    return {
      kind: "unreachable-or-cors",
      message:
        `Could not reach Ollama at the configured base URL. Either the ` +
        `server isn't running, or it's rejecting requests from this ` +
        `extension's origin — set OLLAMA_ORIGINS=chrome-extension://* ` +
        `(or this extension's id) on the Ollama server and restart it.`,
      // Copyable fix (card 14): a blocked preflight and a dead server are
      // indistinguishable here, but "start the server" has no single
      // command worth copying, while the CORS fix does — so this is named
      // for the one env var, not a guess at how the user launches Ollama.
      fix: {
        label: "Set OLLAMA_ORIGINS, then restart Ollama",
        command: "OLLAMA_ORIGINS=chrome-extension://*",
      },
    };
  }
  return {
    kind: "invalid-response",
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * This extension's own origin, when the runtime is available to ask
 * (always true for the side panel and options page this client is called
 * from; guarded defensively rather than assumed). Used only to make the
 * "narrow the wildcard" suggestion below concrete instead of hypothetical.
 */
function ownExtensionOrigin(): string | undefined {
  try {
    const id = chrome.runtime?.id;
    return id ? `chrome-extension://${id}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Unlike the ambiguous TypeError case above, a plain HTTP 403 from Ollama
 * is unambiguous: the server is reachable and definitely rejected THIS
 * request because of its `Origin` header — Ollama has no other concept of
 * authorization (no API keys, no user accounts) that could produce a 403
 * (boards/project-backlog/33-ollama-403-origin-rejection-generic.md).
 * Confirmed against a real server: the rejection carries no body and no
 * extra headers (`curl -H 'Origin: chrome-extension://<32-char-id>'` against
 * an Ollama instance with no `OLLAMA_ORIGINS` override returns a bare
 * `403 Forbidden`, `Content-Length: 0`, regardless of whether the id looks
 * like a real extension id) — so there is nothing in the response itself to
 * key off; the 403 status from this Ollama-specific client is the entire
 * signal, and that's the "isOllama" check card 14/33 asked for: every
 * caller of this module only ever talks to an Ollama server, never a
 * different provider's endpoint, so this mapping can't leak onto an
 * OpenAI-compatible host's unrelated 403s (those go through
 * src/infra/openai, which has its own `ollamaFetchJson`-style
 * function that never calls this).
 *
 * Reuses the `unreachable-or-cors` kind and its `fix` field (card 14's
 * mechanism) rather than inventing a second one — same copyable-fix
 * rendering, same UI branch, just a more specific message for a more
 * specific diagnosis.
 */
function originRejectedError(): OllamaError {
  const selfOrigin = ownExtensionOrigin();
  return {
    kind: "unreachable-or-cors",
    message:
      `Ollama is running, but it rejected this request because of its ` +
      `origin — chrome-extension:// origins aren't in Ollama's default ` +
      `allowlist. On macOS, Ollama.app reads its environment from launchd, ` +
      `so setting export OLLAMA_ORIGINS=... in a terminal will NOT reach ` +
      `it — instead run the command below, then fully quit and reopen ` +
      `Ollama.app. Running ollama serve from a terminal instead of using ` +
      `Ollama.app? Set it there: OLLAMA_ORIGINS="chrome-extension://*" ` +
      `ollama serve. Either way, Ollama only reads this variable at ` +
      `startup — restarting is required, reconfiguring alone won't take ` +
      `effect. Once it's working, consider narrowing the wildcard to just ` +
      `this extension` +
      (selfOrigin ? ` (${selfOrigin})` : "") +
      `, since chrome-extension://* currently lets any installed extension reach this Ollama server.`,
    fix: {
      label: "Set OLLAMA_ORIGINS, then restart Ollama",
      command: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"',
    },
  };
}

async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

async function ollamaFetchJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<ProviderResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (err) {
    return { ok: false, error: toOllamaError(err) };
  }

  if (!response.ok) {
    // See originRejectedError's doc comment: a 403 from this Ollama-specific
    // client always means an origin rejection, not a generic HTTP failure.
    if (response.status === 403) {
      return { ok: false, error: originRejectedError() };
    }
    const body = await safeReadText(response);
    return {
      ok: false,
      error: {
        kind: "http",
        status: response.status,
        statusText: response.statusText,
        body,
      },
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: `Failed to parse JSON response: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    };
  }

  return { ok: true, value: json as T };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Build the `Headers` for one request: custom headers
 * (decisions/15-custom-headers-are-credentials.md) first — for a user
 * putting this Ollama server behind a gateway that wants its own
 * `x-api-key`, tenant header, or `Authorization` (Ollama itself has no
 * API-key concept, so unlike src/infra/openai's client,
 * `Authorization` is never reserved here) — then `Content-Type` set on top
 * so it always wins regardless of what the user typed or how it's cased
 * (`Headers.set` is case-insensitive). Defense in depth only: the options
 * UI (src/options/components/ProviderForm.svelte) is what refuses a
 * reserved header *visibly*, before it's ever saved.
 */
function buildHeaders(
  custom: ProviderHeader[] | undefined,
  contentType?: string,
): Headers {
  const headers = new Headers();
  for (const { key, value } of custom ?? []) {
    if (key.trim().length === 0) continue;
    headers.set(key, value);
  }
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// listModels() — GET /api/tags
// ---------------------------------------------------------------------------

/** A model as reported by `/api/tags`, normalized to a stable shape. */
export interface OllamaModel {
  /** Tag name, e.g. "llama3.1:8b". */
  name: string;
  /** Content digest — the cache key for capability lookups; changes on re-pull. */
  digest: string;
  size: number;
  modifiedAt: string;
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

function normalizeModel(raw: unknown): OllamaModel | null {
  if (!isRecord(raw)) return null;
  const name = raw.name ?? raw.model;
  const digest = raw.digest;
  if (typeof name !== "string" || typeof digest !== "string") return null;

  const details = isRecord(raw.details) ? raw.details : undefined;
  return {
    name,
    digest,
    size: typeof raw.size === "number" ? raw.size : 0,
    modifiedAt: typeof raw.modified_at === "string" ? raw.modified_at : "",
    family: typeof details?.family === "string" ? details.family : undefined,
    parameterSize:
      typeof details?.parameter_size === "string"
        ? details.parameter_size
        : undefined,
    quantizationLevel:
      typeof details?.quantization_level === "string"
        ? details.quantization_level
        : undefined,
  };
}

/** List every locally-pulled model via `GET /api/tags`. `headers` carries custom request headers (decisions/15) — e.g. for an Ollama server sitting behind a gateway. */
export async function listModels(opts?: {
  signal?: AbortSignal;
  baseUrl?: string;
  headers?: ProviderHeader[];
  /** Fallback base-URL source when `baseUrl` is omitted — see {@link resolveBaseUrl}. */
  defaults?: ProviderDefaultsStore;
}): Promise<ProviderResult<OllamaModel[]>> {
  const baseUrl = await resolveBaseUrl(opts?.baseUrl, opts?.defaults);
  const result = await ollamaFetchJson<{ models?: unknown }>(
    baseUrl,
    "/api/tags",
    { method: "GET", headers: buildHeaders(opts?.headers), signal: opts?.signal },
  );
  if (!result.ok) return result;

  const rawModels = Array.isArray(result.value.models)
    ? result.value.models
    : [];
  const models = rawModels
    .map(normalizeModel)
    .filter((m): m is OllamaModel => m !== null);

  return { ok: true, value: models };
}

// ---------------------------------------------------------------------------
// getCapabilities(model) — POST /api/show, digest-cached
// ---------------------------------------------------------------------------

/** Everything `getCapabilities` accepts, shared with its bulk wrapper so the two can never drift. */
interface OllamaCapabilityOptions {
  signal?: AbortSignal;
  baseUrl?: string;
  forceRefresh?: boolean;
  headers?: ProviderHeader[];
  /** Where a previous answer for this model's digest is looked up and filed. Omit and every call hits the network — correct, just slower. */
  capabilityCache?: ModelCapabilityCache;
  /** Fallback base-URL source when `baseUrl` is omitted — see {@link resolveBaseUrl}. */
  defaults?: ProviderDefaultsStore;
}

/**
 * Get whether `model` supports tool calling, via `POST /api/show`.
 *
 * The answer only changes when a model is re-pulled (which changes its
 * digest), so results are cached by digest in whatever
 * {@link ModelCapabilityCache} the caller supplies, and this never re-hits
 * the network for a digest it has already seen unless `forceRefresh` is set.
 * Callers building a model picker should issue these concurrently across
 * models — see {@link getCapabilitiesForModels}.
 *
 * Ollama always has a definitive answer, so this only ever resolves to
 * `"tool-capable"` or `"no-tools"` — never `"unknown"`. `"unknown"` exists on
 * the shared {@link ModelCapabilities} type for providers with no capability
 * API (decisions/11-provider-capability-detection.md).
 */
export async function getCapabilities(
  model: Pick<OllamaModel, "name" | "digest">,
  opts?: OllamaCapabilityOptions,
): Promise<ProviderResult<ModelCapabilities>> {
  if (!opts?.forceRefresh) {
    const cached = await opts?.capabilityCache?.get("ollama", model.digest);
    if (cached) return { ok: true, value: cached };
  }

  const baseUrl = await resolveBaseUrl(opts?.baseUrl, opts?.defaults);
  const result = await ollamaFetchJson<{ capabilities?: unknown }>(
    baseUrl,
    "/api/show",
    {
      method: "POST",
      headers: buildHeaders(opts?.headers, "application/json"),
      body: JSON.stringify({ model: model.name }),
      signal: opts?.signal,
    },
  );
  if (!result.ok) return result;

  const capabilities = Array.isArray(result.value.capabilities)
    ? result.value.capabilities.filter(
        (c): c is string => typeof c === "string",
      )
    : [];
  const value: ModelCapabilities = {
    status: capabilities.includes("tools") ? "tool-capable" : "no-tools",
    detail: capabilities,
  };

  await opts?.capabilityCache?.set("ollama", model.digest, value);
  return { ok: true, value };
}

/**
 * Convenience wrapper: fetch capabilities for every model concurrently
 * (decisions/06-tool-capable-models-only.md's "issued concurrently and
 * cached thereafter," carried forward unchanged by
 * decisions/11-provider-capability-detection.md). Each entry's result is
 * independent, so one model's error does not fail the others.
 */
export async function getCapabilitiesForModels(
  models: Pick<OllamaModel, "name" | "digest">[],
  opts?: OllamaCapabilityOptions,
): Promise<ProviderResult<ModelCapabilities>[]> {
  return Promise.all(models.map((model) => getCapabilities(model, opts)));
}

// ---------------------------------------------------------------------------
// Tool schema conversion — SerializedTool -> Ollama's function-tool shape
// ---------------------------------------------------------------------------

/** Ollama's `/api/chat` tool definition shape. */
export interface OllamaToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert a page-supplied {@link SerializedTool} into Ollama's tool-def
 * shape. Defensive because `inputSchema` crossed a JS-world boundary from
 * arbitrary page script and may be missing or malformed (not a plain object,
 * an array, etc.) — in that case we fall back to an empty object schema
 * rather than sending Ollama something that breaks the request.
 */
export function toOllamaTool(tool: SerializedTool): OllamaToolDefinition {
  const parameters = isRecord(tool.inputSchema)
    ? tool.inputSchema
    : { type: "object", properties: {} };

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters,
    },
  };
}

// ---------------------------------------------------------------------------
// chat() — POST /api/chat, NDJSON streaming
// ---------------------------------------------------------------------------

/** A chat message as sent to `/api/chat`. */
export interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on an assistant message that requested tool calls. */
  tool_calls?: OllamaToolCall[];
  /** Optionally set on a `role: "tool"` message to name which tool produced `content`. */
  tool_name?: string;
}

/**
 * A single tool call requested by the model. Ollama's wire format assigns no
 * call id; `id` here is synthesized locally by {@link chat}'s stream parser
 * (one counter per call to `chat`, stable across the `"tool-calls"` event
 * and the terminal `"done"` event's message for the same call) so downstream
 * consumers — in particular the `ChatProvider` adapter in
 * ./adapter.ts — can always rely on an id being present on an
 * inbound call, without inventing their own scheme. Left unset when this
 * type is used to build an *outbound* message (replaying history back to
 * Ollama): the id is a local-only correlation aid, never sent on the wire.
 */
export interface OllamaToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/** Final generation stats, present on the terminal `"done"` stream event. */
export interface OllamaChatStats {
  doneReason?: string;
  totalDuration?: number;
  loadDuration?: number;
  promptEvalCount?: number;
  promptEvalDuration?: number;
  evalCount?: number;
  evalDuration?: number;
}

/**
 * One event out of {@link chat}'s stream. Modeled as a tagged union (rather
 * than a callback per event kind) so an agent loop can drive it with a
 * single `for await` + `switch`.
 */
export type OllamaStreamEvent =
  | { type: "content"; delta: string }
  | { type: "tool-calls"; toolCalls: OllamaToolCall[] }
  | { type: "done"; message: OllamaChatMessage; stats: OllamaChatStats }
  | { type: "error"; error: OllamaError };

export interface OllamaChatParams {
  model: string;
  messages: OllamaChatMessage[];
  /** Page tools to offer the model; converted via {@link toOllamaTool}. Omit or pass `[]` for no tools. */
  tools?: SerializedTool[];
  /** Tied to the panel's lifetime — aborting mid-stream ends the generator with a "aborted" error event. */
  signal?: AbortSignal;
  baseUrl?: string;
  /** Custom request headers (decisions/15-custom-headers-are-credentials.md) — e.g. for an Ollama server sitting behind a gateway. */
  headers?: ProviderHeader[];
  /** Fallback base-URL source when `baseUrl` is omitted — see {@link resolveBaseUrl}. */
  defaults?: ProviderDefaultsStore;
}

function normalizeToolCall(
  raw: unknown,
  nextId: () => string,
): OllamaToolCall | null {
  if (!isRecord(raw) || !isRecord(raw.function)) return null;
  const name = raw.function.name;
  if (typeof name !== "string") return null;
  const args = isRecord(raw.function.arguments) ? raw.function.arguments : {};
  return { id: nextId(), function: { name, arguments: args } };
}

function normalizeChatMessage(
  raw: unknown,
  nextId: () => string,
  precomputedToolCalls?: OllamaToolCall[],
): OllamaChatMessage {
  const record = isRecord(raw) ? raw : {};
  const role = record.role;
  // Reuse the tool calls already parsed for this line's "tool-calls" event
  // when present, so a call's id matches between that event and the "done"
  // message that repeats it, rather than re-synthesizing a second id for
  // the same call.
  const toolCalls =
    precomputedToolCalls ??
    (Array.isArray(record.tool_calls)
      ? record.tool_calls
          .map((tc) => normalizeToolCall(tc, nextId))
          .filter((tc): tc is OllamaToolCall => tc !== null)
      : undefined);

  return {
    role:
      role === "system" || role === "user" || role === "tool"
        ? role
        : "assistant",
    content: typeof record.content === "string" ? record.content : "",
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function extractStats(raw: Record<string, unknown>): OllamaChatStats {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  return {
    doneReason: typeof raw.done_reason === "string" ? raw.done_reason : undefined,
    totalDuration: num(raw.total_duration),
    loadDuration: num(raw.load_duration),
    promptEvalCount: num(raw.prompt_eval_count),
    promptEvalDuration: num(raw.prompt_eval_duration),
    evalCount: num(raw.eval_count),
    evalDuration: num(raw.eval_duration),
  };
}

/** Yields 0-2 events for one parsed NDJSON line: an optional content delta and/or tool-calls, then an optional terminal done. */
function* chatEventsFromLine(
  raw: unknown,
  nextId: () => string,
): Generator<OllamaStreamEvent> {
  if (!isRecord(raw)) return;

  const message = isRecord(raw.message) ? raw.message : undefined;
  let toolCalls: OllamaToolCall[] | undefined;
  if (message) {
    if (typeof message.content === "string" && message.content.length > 0) {
      yield { type: "content", delta: message.content };
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const parsed = message.tool_calls
        .map((tc) => normalizeToolCall(tc, nextId))
        .filter((tc): tc is OllamaToolCall => tc !== null);
      if (parsed.length > 0) {
        toolCalls = parsed;
        yield { type: "tool-calls", toolCalls };
      }
    }
  }

  if (raw.done === true) {
    yield {
      type: "done",
      message: normalizeChatMessage(message, nextId, toolCalls),
      stats: extractStats(raw),
    };
  }
}

function parseNdjsonLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  return JSON.parse(trimmed);
}

/**
 * Stream a chat completion from `POST /api/chat`, reading NDJSON off
 * `response.body.getReader()`.
 *
 * Never throws: a request-setup failure (unreachable/CORS, non-2xx, no
 * body) or a mid-stream failure (abort, malformed JSON) is surfaced as a
 * single terminal `{ type: "error" }` event and the generator then returns.
 * On success the generator ends after the `{ type: "done" }` event.
 *
 * The NDJSON reader is partial-line safe: chunk boundaries never align with
 * line boundaries, and the final line commonly arrives without a trailing
 * newline, so incomplete text is buffered across reads and the buffer is
 * flushed once more after the stream closes.
 */
export async function* chat(
  params: OllamaChatParams,
): AsyncGenerator<OllamaStreamEvent, void, void> {
  const { model, messages, tools, signal, headers } = params;
  const baseUrl = await resolveBaseUrl(params.baseUrl, params.defaults);

  // One counter per call to `chat`, so every tool call's synthesized id is
  // unique for the lifetime of this stream regardless of how many NDJSON
  // lines it's spread across.
  let toolCallSeq = 0;
  const nextToolCallId = () => `ollama-tool-${toolCallSeq++}`;

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (tools && tools.length > 0) {
    requestBody.tools = tools.map(toOllamaTool);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: buildHeaders(headers, "application/json"),
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (err) {
    yield { type: "error", error: toOllamaError(err) };
    return;
  }

  if (!response.ok) {
    // See originRejectedError's doc comment: a 403 from this Ollama-specific
    // client always means an origin rejection, not a generic HTTP failure.
    if (response.status === 403) {
      yield { type: "error", error: originRejectedError() };
      return;
    }
    const body = await safeReadText(response);
    yield {
      type: "error",
      error: {
        kind: "http",
        status: response.status,
        statusText: response.statusText,
        body,
      },
    };
    return;
  }

  if (!response.body) {
    yield {
      type: "error",
      error: {
        kind: "invalid-response",
        message: "Response had no body to stream.",
      },
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const parsed = parseNdjsonLine(line);
        if (parsed !== undefined) {
          yield* chatEventsFromLine(parsed, nextToolCallId);
        }
      }
    }

    // Flush the decoder's internal state, then the final line — the server
    // commonly closes the stream without a trailing newline.
    buffer += decoder.decode();
    const parsed = parseNdjsonLine(buffer);
    if (parsed !== undefined) {
      yield* chatEventsFromLine(parsed, nextToolCallId);
    }
  } catch (err) {
    yield { type: "error", error: toOllamaError(err) };
  } finally {
    reader.releaseLock();
  }
}
