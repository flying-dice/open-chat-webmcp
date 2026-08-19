---
column: review
labels: [backend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T00:00:00.000Z
---
# OpenAI Chat Completions provider

Concrete `ChatProvider` (card 20) for OpenAI's `/v1/chat/completions`, and any
OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, local servers using the same
wire format) via a configurable base URL
(decisions/09-provider-agnostic-chat-transport.md).

Tool-capability detection uses a static allowlist with an explicit "unknown" state
rather than Ollama's live capability query (decisions/11-provider-capability-detection.md).

## Checklist

- [x] SSE stream parse (vs. Ollama's NDJSON), partial-event safe
- [x] Bearer API key auth header, sourced from the provider registry (card 20)
- [x] Convert WebMCP `inputSchema` to OpenAI's `tools`/`tool_choice` format
- [x] `listModels()` via `/v1/models` where supported, else user-entered model id
- [x] `getCapabilities(model)`: static tool-calling allowlist, "unknown" for unlisted models
- [x] Distinguish 401 auth failure / host-not-permitted / server-down as named error states

## Comments

- **claude** (2026-08-19T18:45:00.000Z): Implemented `createOpenAiProvider` in `src/lib/providers/openai.ts:1-725` (one file — OpenAI's wire shapes are close enough to the shared vocabulary in `src/lib/provider.ts` that no separate raw-client/adapter split like Ollama's was needed).
  SSE parsing lives in `extractSseEvents`/`SseParseState` (`src/lib/providers/openai.ts:390-461`): both the line buffer and the in-progress event's `data:` lines persist in `state` across `reader.read()` calls, so a line, a blank-line event terminator, or a UTF-8 multibyte codepoint split at any byte offset assembles correctly; `flush: true` at stream end (`src/lib/providers/openai.ts:602-609`) treats a trailing line with no `\n` and an event with no closing blank line as complete, covering "final event has no trailing blank line."
  Fragmented tool-call deltas are accumulated by `index` in `toolCallAccumulators` (`src/lib/providers/openai.ts:483-522`, `finalizeToolCalls` at `:559-583`) — name and arguments strings are concatenated across every delta for that index and `JSON.parse`d exactly once, only after `finish_reason`/stream end, never on a partial fragment; a missing wire `id` is synthesized as `openai-tool-<index>`.
  Capability allowlist (decisions/11) is `TOOL_CAPABLE_MODELS`/`NO_TOOLS_MODELS` in `src/lib/providers/openai.ts:262-322`; anything unlisted resolves to `status: "unknown"` with a `detail` reason (`:333-338`), never guessed as safe.
  401/403 classify as `ProviderError` kind `"auth"`, 404/405 on `/v1/models` as `"not-supported"` (`toHttpError`, `src/lib/providers/openai.ts:120-152`), CORS/unreachable and abort mirror `src/lib/ollama.ts`'s `toOllamaError` pattern (`:73-96`).
  Registration: since `src/lib/providers/registry.ts` is owned by concurrent work, `openai.ts` self-registers (`registerProviderType("openai", createOpenAiProvider)` at `src/lib/providers/openai.ts:725`) the same way `registry.ts` self-registers Ollama at its own bottom — importing `./providers/registry` only, never editing it. This means the factory only becomes live once something imports `./providers/openai` (e.g. card 22's registry UI); flagged as a wiring note for that card, not a gap in the shared contract.
  Verified with a scratchpad harness (`/private/tmp/.../scratchpad/tscwork/dist/test-harness.mjs`, not committed) that transpiles this module with fabricated SSE payloads and a stubbed `fetch`/`ReadableStream`: content streaming and fragmented tool-call assembly are each replayed with the response body split at every byte offset (multibyte UTF-8 case) or every 3rd/7th byte (others) to prove chunk-boundary independence — 1724 assertions, 0 failures. Also covers no-id-on-wire synthesis, no-trailing-blank-line and no-sentinel-at-all stream endings, 401 vs 404 vs generic-http vs unreachable vs abort classification, `listModels` not-supported/auth/ok, capability tri-state, and defensive tool-schema conversion (malformed/array/missing `inputSchema`).
  `npm run check` (0 errors, 0 warnings) and `npm run build` green throughout, no other repo files touched.
