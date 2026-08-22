// `ChatProvider` client for OpenAI's `/v1/chat/completions`, and any
// OpenAI-compatible endpoint (Azure OpenAI behind an OpenAI-shaped shim,
// OpenRouter, local servers speaking the same wire format) via a
// configurable base URL (decisions/09-provider-agnostic-chat-transport.md,
// decisions/11-provider-capability-detection.md). This is both the raw wire
// client and the `ChatProvider` adapter in one file — unlike Ollama's split
// (src/infra/ollama/client.ts + src/infra/ollama/adapter.ts), OpenAI's wire
// shapes (roles, content, tool calls with an `id`) are already close enough
// to the shared vocabulary in src/domain/providers/provider.ts that there is
// no separate "OpenAI-native" type family worth introducing.
//
// The two things that differ from Ollama's client and are the actual work
// here:
//   - Streaming is SSE (`data: {...}` lines, `[DONE]` sentinel), not NDJSON.
//     The parser below is chunk-boundary-safe and tolerates the final event
//     arriving without a trailing blank line, the same way Ollama's NDJSON
//     reader tolerates a final line with no trailing newline.
//   - Tool calls stream as fragments keyed by `index`: the function name and
//     the JSON-arguments string each arrive incrementally across many SSE
//     events. They are accumulated by index and only turned into a
//     `ToolCall` (with `JSON.parse`d arguments) once the stream signals
//     completion — never `JSON.parse`d while still partial.
//
// Never-throw discipline (decisions/09, carried from src/infra/ollama):
// `listModels`/`getCapabilities` return a `ProviderResult`, and `chat` yields
// a terminal `{ type: "error" }` event instead of throwing.
//
// Card 75 (decisions/29): this used to self-register into the old
// src/lib/providers/clients.ts locator (`registerProviderType("openai",
// createOpenAiProvider)` at the bottom of the file) since that module was
// off-limits to the card that landed this client. The locator is gone —
// each composition root's `createProviderClientFactory` map
// (src/sidepanel/main.ts, src/options/main.ts) imports `createOpenAiProvider`
// directly and puts it in an exhaustive `Record<ProviderType, ...>` instead.

import type { SerializedTool } from "../../domain/tools";
import type {
  ChatMessage,
  ChatParams,
  ChatProvider,
  ChatStats,
  ChatStreamEvent,
  ModelCapabilities,
  ProviderError,
  ProviderHeader,
  ProviderConfig,
  ProviderModel,
  ProviderResult,
  ToolCall,
} from "../../domain/providers";
import { DEFAULT_OPENAI_BASE_URL } from "../../domain/providers";

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

/**
 * Re-exported for this adapter's own callers; card 78 moved the value itself
 * to src/domain/providers, where the options form can read it without
 * importing an adapter. See its doc comment there for what `baseUrl` means.
 */
export { DEFAULT_OPENAI_BASE_URL } from "../../domain/providers";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// TODO: clean-code - 0.3 - DRY: this isRecord predicate is reimplemented independently at least nine times across src/ (area.ts, json-rpc.ts, ollama/client.ts, relay.ts, sw.ts, SchemaProperty.svelte, ToolSchema.svelte, ToolArgValue.svelte).
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toOpenAiError(err: unknown): ProviderError {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "aborted" };
  }
  // A blocked CORS preflight (host permission not granted) and a genuinely
  // unreachable host both reject `fetch` with a bare TypeError — there is no
  // way to distinguish them from here, mirroring src/infra/ollama/client.ts's
  // `toOllamaError`. Name the ambiguity explicitly rather than reporting a
  // generic network error.
  if (err instanceof TypeError) {
    return {
      kind: "unreachable-or-cors",
      message:
        `Could not reach the configured OpenAI-compatible endpoint. Either ` +
        `the host is down, or this extension hasn't been granted permission ` +
        `to talk to it yet — grant the host permission for this provider on ` +
        `the options page and try again.`,
    };
  }
  return {
    kind: "invalid-response",
    message: err instanceof Error ? err.message : String(err),
  };
}

// TODO: clean-code - 0.35 - DRY: this safeReadText is independently redefined in src/infra/mcp/json-rpc.ts and src/infra/ollama/client.ts; adapters-do-not-import-adapters blocks a shared infra util but nothing stops passing the body as an argument instead.
async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort extraction of `{"error":{"message": "..."}}}`, OpenAI's standard error body shape. Falls back to the raw body text. */
function extractErrorMessage(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = parsed.error.message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body;
}

/**
 * Build the `Headers` for one request: custom headers (decisions/15) first,
 * then this client's own correctness-critical headers set on top — `Headers`
 * comparisons and `.set` are case-insensitive, so setting them last means
 * they always win regardless of what the user typed or how it's cased, the
 * same guarantee `reservedHeaderReason` (src/domain/providers/provider.ts) describes at
 * edit time. This is defense in depth, not the primary enforcement — the
 * options UI (src/options/components/ProviderForm.svelte) is what refuses a
 * reserved header *visibly*, before it's ever saved.
 *
 * `Authorization` is the one client-controlled header that's conditional:
 * only set here when `apiKey` is present, so a user-supplied `Authorization`
 * (allowed only when no API key is configured, per decision 15) survives
 * untouched.
 */
function buildHeaders(
  apiKey: string | undefined,
  custom: ProviderHeader[] | undefined,
  clientControlled: { "Content-Type"?: string; Accept?: string },
): Headers {
  const headers = new Headers();
  for (const { key, value } of custom ?? []) {
    if (key.trim().length === 0) continue;
    headers.set(key, value);
  }
  if (clientControlled["Content-Type"]) {
    headers.set("Content-Type", clientControlled["Content-Type"]);
  }
  if (clientControlled.Accept) {
    headers.set("Accept", clientControlled.Accept);
  }
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

/** Classify a non-2xx response into the shared `ProviderError` union, distinguishing 401 auth failures and (for endpoints without `/v1/models`) 404/405 as `not-supported` when `treatMissingAsNotSupported` is set. */
async function toHttpError(
  response: Response,
  opts?: { treatMissingAsNotSupported?: boolean },
): Promise<ProviderError> {
  const body = await safeReadText(response);
  const message = extractErrorMessage(body);

  if (response.status === 401 || response.status === 403) {
    return {
      kind: "auth",
      status: response.status,
      message: message ?? "Authentication failed. Check the API key for this provider.",
    };
  }

  if (opts?.treatMissingAsNotSupported && (response.status === 404 || response.status === 405)) {
    return {
      kind: "not-supported",
      message: "This endpoint does not expose a model-listing API. Enter a model id manually.",
    };
  }

  // `ProviderError`'s `"http".body` (src/domain/providers/provider.ts, not
  // this folder's to widen) is optional without `| undefined` — conditional
  // spread so an absent message omits the key instead of assigning it
  // `undefined`.
  return {
    kind: "http",
    status: response.status,
    statusText: response.statusText,
    ...(message !== undefined && { body: message }),
  };
}

// ---------------------------------------------------------------------------
// listModels() — GET /v1/models
// ---------------------------------------------------------------------------

function normalizeModel(raw: unknown): ProviderModel | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  if (typeof id !== "string" || id.length === 0) return null;
  // OpenAI-compatible listings have no separate display name and no content
  // digest (decisions/11: capability caching, when a client does it at all,
  // is keyed by `id` instead) — `cacheKey` is intentionally omitted.
  return { id, name: id };
}

async function listModels(
  baseUrl: string,
  apiKey: string | undefined,
  headers: ProviderHeader[] | undefined,
  opts?: { signal?: AbortSignal },
): Promise<ProviderResult<ProviderModel[]>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: buildHeaders(apiKey, headers, { Accept: "application/json" }),
      // `RequestInit.signal` (lib.dom.d.ts) is `AbortSignal | null`, not
      // `| undefined` — conditional spread so an absent signal omits the
      // key instead of assigning it `undefined`.
      ...(opts?.signal !== undefined && { signal: opts.signal }),
    });
  } catch (err) {
    return { ok: false, error: toOpenAiError(err) };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: await toHttpError(response, { treatMissingAsNotSupported: true }),
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

  const rawModels = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const models = rawModels.map(normalizeModel).filter((m): m is ProviderModel => m !== null);

  return { ok: true, value: models };
}

// ---------------------------------------------------------------------------
// getCapabilities(model) — static allowlist (decisions/11)
// ---------------------------------------------------------------------------

/**
 * Maintained allowlist of OpenAI model ids known to support function/tool
 * calling. OpenAI exposes no per-model capability field, so this is the only
 * source of a definitive "yes" (decisions/11). A model id not listed here —
 * and not in {@link NO_TOOLS_MODELS} — resolves to `"unknown"`, never a
 * guessed "no". This needs periodic upkeep as OpenAI ships new models; that
 * maintenance burden is an accepted tradeoff of decision 11 versus guessing
 * wrong and silently dropping tool calls.
 */
const TOOL_CAPABLE_MODELS = new Set<string>([
  // GPT-4o family
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  // GPT-4 Turbo family
  "gpt-4-turbo",
  "gpt-4-turbo-2024-04-09",
  "gpt-4-turbo-preview",
  "gpt-4-0125-preview",
  "gpt-4-1106-preview",
  // GPT-4
  "gpt-4",
  "gpt-4-0613",
  // GPT-4.1 family
  "gpt-4.1",
  "gpt-4.1-2025-04-14",
  "gpt-4.1-mini",
  "gpt-4.1-mini-2025-04-14",
  "gpt-4.1-nano",
  "gpt-4.1-nano-2025-04-14",
  // GPT-3.5 Turbo family (post tool-calling launch)
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-0613",
  "gpt-3.5-turbo-1106",
  "gpt-3.5-turbo-0125",
  // o-series with documented function-calling support
  "o3",
  "o3-2025-04-16",
  "o3-mini",
  "o3-mini-2025-01-31",
  "o4-mini",
  "o4-mini-2025-04-16",
  // GPT-5 family
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
]);

/**
 * Models confirmed NOT to support tool calling — e.g. OpenAI's earliest
 * o1-preview/o1-mini releases, which launched without function-calling
 * support, and the pre-tool-calling `gpt-3.5-turbo-0301` snapshot. Kept
 * separate from "unlisted" so these render as "no-tools" (a definitive
 * answer) rather than "unknown".
 */
const NO_TOOLS_MODELS = new Set<string>([
  "gpt-3.5-turbo-0301",
  "o1-preview",
  "o1-preview-2024-09-12",
  "o1-mini",
  "o1-mini-2024-09-12",
]);

function getCapabilities(model: ProviderModel): ModelCapabilities {
  if (TOOL_CAPABLE_MODELS.has(model.id)) {
    return {
      status: "tool-capable",
      detail: ["On the OpenAI tool-calling allowlist."],
    };
  }
  if (NO_TOOLS_MODELS.has(model.id)) {
    return {
      status: "no-tools",
      detail: ["Confirmed not to support tool calling."],
    };
  }
  return {
    status: "unknown",
    detail: ["Not on the OpenAI tool-calling allowlist; support unverified."],
  };
}

// ---------------------------------------------------------------------------
// Tool schema conversion — SerializedTool -> OpenAI's `tools` format
// ---------------------------------------------------------------------------

/** OpenAI's `/v1/chat/completions` tool definition shape. */
export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert a page-supplied {@link SerializedTool} into OpenAI's tool-def
 * shape. Defensive because `inputSchema` crossed a JS-world boundary from
 * arbitrary page script and may be missing or malformed (not a plain object,
 * an array, etc.) — falls back to an empty object schema rather than sending
 * OpenAI something that gets the whole request rejected.
 */
export function toOpenAiTool(tool: SerializedTool): OpenAiToolDefinition {
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
// Message conversion — shared ChatMessage <-> OpenAI's wire message shape
// ---------------------------------------------------------------------------

interface OpenAiOutboundToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiOutboundMessage {
  role: ChatMessage["role"];
  content: string;
  tool_calls?: OpenAiOutboundToolCall[];
  tool_call_id?: string;
  name?: string;
}

function toOpenAiMessage(message: ChatMessage): OpenAiOutboundMessage {
  const base: OpenAiOutboundMessage = {
    role: message.role,
    content: message.content,
  };
  if (message.role === "tool") {
    // OpenAI requires `tool_call_id` to correlate a tool result back to the
    // call that requested it; `toolName` (Ollama's `/api/chat` convention)
    // has no wire equivalent here and is intentionally not sent.
    base.tool_call_id = message.toolCallId ?? "";
    return base;
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    base.tool_calls = message.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  return base;
}

// ---------------------------------------------------------------------------
// chat() — POST /v1/chat/completions, SSE streaming
// ---------------------------------------------------------------------------

/** Accumulator for one tool call's fragments, keyed by its stream `index`. */
interface ToolCallAccumulator {
  id?: string;
  name: string;
  argumentsText: string;
}

interface SseParseState {
  /** Bytes decoded but not yet consumed as a complete line. Persists across reads so a line split across chunk boundaries is assembled correctly. */
  buffer: string;
  /** `data:` line values collected for the event currently being assembled. Persists across reads so an event whose lines straddle a chunk boundary is assembled correctly. Flushed into an emitted event on a blank line, or by `flush: true` at end of stream. */
  currentData: string[];
}

/**
 * Split whatever's newly available in `state.buffer` into complete `data:`
 * payload strings, in arrival order, leaving any trailing partial line (and
 * any not-yet-terminated event) buffered in `state` for the next call. SSE
 * events are separated by a blank line; this parser is chunk-boundary-safe
 * at both the line level (`state.buffer`) and the event level
 * (`state.currentData`) — neither is reset per call, so a `data:` line, or a
 * blank-line event terminator, split across two `reader.read()` chunks is
 * still assembled correctly.
 *
 * With `flush: true` (only at end of stream), also treats a trailing
 * buffered line with no terminating `\n` as a complete line, and emits
 * whatever's accumulated in `state.currentData` even without a closing blank
 * line — the "final event arrives without a trailing blank line" case.
 *
 * Only extracts `data:` lines — comment lines (leading `:`) and other SSE
 * fields (`event:`, `id:`, `retry:`) that OpenAI's wire format doesn't use
 * are ignored rather than rejected, so an OpenAI-compatible host that adds
 * one doesn't break parsing.
 */
function extractSseEvents(state: SseParseState, opts?: { flush?: boolean }): string[] {
  const events: string[] = [];

  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      // Blank line: event boundary.
      if (state.currentData.length > 0) {
        events.push(state.currentData.join("\n"));
        state.currentData = [];
      }
      return;
    }
    if (line.startsWith("data:")) {
      const value = line.slice(5);
      state.currentData.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    // Any other field (event:, id:, retry:, or a `:`-prefixed comment) is
    // intentionally ignored — OpenAI's format never sends them.
  };

  while (true) {
    const newlineIndex = state.buffer.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);
    consumeLine(line);
  }

  if (opts?.flush) {
    if (state.buffer.length > 0) {
      const trailing = state.buffer;
      state.buffer = "";
      consumeLine(trailing);
    }
    if (state.currentData.length > 0) {
      events.push(state.currentData.join("\n"));
      state.currentData = [];
    }
  }

  return events;
}

function parseSseDataPayload(payload: string): unknown | typeof DONE {
  if (payload === "[DONE]") return DONE;
  return JSON.parse(payload);
}

const DONE = Symbol("sse-done");

async function* chat(
  baseUrl: string,
  apiKey: string | undefined,
  headers: ProviderHeader[] | undefined,
  params: ChatParams,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const { model, messages, tools, signal } = params;

  const requestBody: Record<string, unknown> = {
    model,
    messages: messages.map(toOpenAiMessage),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools && tools.length > 0) {
    requestBody.tools = tools.map(toOpenAiTool);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: buildHeaders(apiKey, headers, {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      }),
      body: JSON.stringify(requestBody),
      // See listModels' matching comment on RequestInit.signal.
      ...(signal !== undefined && { signal }),
    });
  } catch (err) {
    yield { type: "error", error: toOpenAiError(err) };
    return;
  }

  if (!response.ok) {
    yield { type: "error", error: await toHttpError(response) };
    return;
  }

  if (!response.body) {
    yield {
      type: "error",
      error: { kind: "invalid-response", message: "Response had no body to stream." },
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: SseParseState = { buffer: "", currentData: [] };

  // Accumulated across the whole stream, keyed by the delta's `index`, since
  // OpenAI fragments a tool call's function name and JSON-arguments string
  // across many SSE events rather than sending one complete call per event
  // the way Ollama does. Arguments are never `JSON.parse`d until the stream
  // signals completion (`finish_reason` seen, or the connection closes).
  const toolCallAccumulators = new Map<number, ToolCallAccumulator>();
  let accumulatedContent = "";
  let finishReason: string | undefined;
  let usage: Record<string, unknown> | undefined;
  let sawDone = false;

  function applyDelta(json: unknown): ChatStreamEvent | undefined {
    if (!isRecord(json)) return undefined;

    if (isRecord(json.usage)) {
      usage = json.usage;
    }

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = choices[0];
    if (!isRecord(choice)) return undefined;

    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }

    const delta = isRecord(choice.delta) ? choice.delta : undefined;
    if (!delta) return undefined;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      accumulatedContent += delta.content;
      return { type: "content", delta: delta.content };
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        if (!isRecord(raw) || typeof raw.index !== "number") continue;
        const existing = toolCallAccumulators.get(raw.index) ?? {
          name: "",
          argumentsText: "",
        };
        if (typeof raw.id === "string" && raw.id.length > 0) {
          existing.id = raw.id;
        }
        if (isRecord(raw.function)) {
          if (typeof raw.function.name === "string") {
            existing.name += raw.function.name;
          }
          if (typeof raw.function.arguments === "string") {
            existing.argumentsText += raw.function.arguments;
          }
        }
        toolCallAccumulators.set(raw.index, existing);
      }
    }

    return undefined;
  }

  function finalizeToolCalls(): ToolCall[] {
    const indices = [...toolCallAccumulators.keys()].sort((a, b) => a - b);
    const calls: ToolCall[] = [];
    for (const index of indices) {
      const acc = toolCallAccumulators.get(index);
      if (!acc) continue;
      let args: Record<string, unknown> = {};
      if (acc.argumentsText.trim().length > 0) {
        try {
          const parsed: unknown = JSON.parse(acc.argumentsText);
          if (isRecord(parsed)) args = parsed;
        } catch {
          // Malformed/incomplete JSON from the provider — never throw here;
          // fall back to an empty-args call rather than dropping it, same
          // never-throw discipline as the rest of this module.
        }
      }
      calls.push({
        id: acc.id ?? `openai-tool-${index}`,
        name: acc.name,
        arguments: args,
      });
    }
    return calls;
  }

  function buildStats(): ChatStats {
    const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
    const promptTokens = usage ? num(usage.prompt_tokens) : undefined;
    const completionTokens = usage ? num(usage.completion_tokens) : undefined;
    // `ChatStats`'s fields (src/domain/providers/provider.ts, not this
    // folder's to widen) are optional without `| undefined` — conditional
    // spread so an absent value omits the key instead of assigning it
    // `undefined`.
    return {
      ...(finishReason !== undefined && { doneReason: finishReason }),
      ...(promptTokens !== undefined && { promptTokens }),
      ...(completionTokens !== undefined && { completionTokens }),
      ...(usage !== undefined && { raw: usage }),
    };
  }

  function* finalize(): Generator<ChatStreamEvent> {
    const toolCalls = finalizeToolCalls();
    if (toolCalls.length > 0) {
      yield { type: "tool-calls", toolCalls };
    }
    const message: ChatMessage = {
      role: "assistant",
      content: accumulatedContent,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
    yield { type: "done", message, stats: buildStats() };
  }

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      state.buffer += decoder.decode(value, { stream: true });
      const events = extractSseEvents(state);
      for (const payload of events) {
        if (payload.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = parseSseDataPayload(payload);
        } catch {
          // Malformed JSON on one event — skip it rather than aborting the
          // whole stream; a later event (or the terminal done/usage) still
          // carries the generation forward.
          continue;
        }
        if (parsed === DONE) {
          sawDone = true;
          break outer;
        }
        const event = applyDelta(parsed);
        if (event) yield event;
      }
    }

    if (!sawDone) {
      // Flush the decoder's internal state, then handle whatever is left:
      // either a final line with no trailing newline, or a final event that
      // never got its trailing blank line (the common end-of-stream shape
      // for many OpenAI-compatible servers) — `flush: true` handles both.
      state.buffer += decoder.decode();
      const events = extractSseEvents(state, { flush: true });
      for (const payload of events) {
        if (payload.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = parseSseDataPayload(payload);
        } catch {
          continue;
        }
        if (parsed === DONE) break;
        const event = applyDelta(parsed);
        if (event) yield event;
      }
    }

    yield* finalize();
  } catch (err) {
    yield { type: "error", error: toOpenAiError(err) };
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ChatProvider factory
// ---------------------------------------------------------------------------

/** Build a `ChatProvider` bound to one resolved OpenAI(-compatible) provider config. */
export function createOpenAiProvider(config: ProviderConfig): ChatProvider {
  const baseUrl = config.baseUrl || DEFAULT_OPENAI_BASE_URL;
  const apiKey = config.apiKey;
  const headers = config.headers;

  return {
    type: "openai",

    listModels(opts) {
      return listModels(baseUrl, apiKey, headers, opts);
    },

    // Static allowlist lookup (decisions/11) — never fails, so this always
    // resolves `ok: true`; `forceRefresh`/`signal` are accepted for
    // interface compatibility but unused, since there is no network call to
    // skip or cancel.
    async getCapabilities(model): Promise<ProviderResult<ModelCapabilities>> {
      return { ok: true, value: getCapabilities(model) };
    },

    chat(params: ChatParams) {
      return chat(baseUrl, apiKey, headers, params);
    },
  };
}
