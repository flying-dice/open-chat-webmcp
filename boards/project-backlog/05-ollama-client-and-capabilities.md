---
column: review
labels: [backend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T16:40:00.000Z
---
# Ollama provider client: models, tool capability, streaming chat

The Ollama implementation of the `ChatProvider` interface (card 20): typed client
for `/api/tags`, `/api/show`, and `/api/chat`, called directly from the side panel
(decisions/09-provider-agnostic-chat-transport.md).

Model list is partitioned by tool support using `capabilities.includes("tools")`
from `/api/show` — non-tool models stay visible but disabled, never hidden
(decisions/11-provider-capability-detection.md). Cache capability by model digest in
`chrome.storage.local`.

Streaming is an NDJSON read loop off `response.body.getReader()` with an
`AbortController` tied to the panel's lifetime.

## Checklist

- [x] `listModels()` via `/api/tags`
- [x] `getCapabilities(model)` via `/api/show`, concurrent across models, digest-cached
- [x] `chat({model, messages, tools, signal})` streaming NDJSON, partial-line safe
- [x] Surface `message.tool_calls` from the stream to the agent loop
- [x] Convert WebMCP `inputSchema` to Ollama's `{type:"function", function:{...}}`
- [x] Distinguish CORS failure from server-down and report it as such
- [x] Configurable base URL, default `http://localhost:11434`

## Comments

- **claude** (2026-08-19T16:40:00.000Z): Implemented the pure client in `src/lib/ollama.ts`. `listModels()` (src/lib/ollama.ts:212) hits `GET /api/tags`; `getCapabilities()` (src/lib/ollama.ts:302) and its concurrency helper `getCapabilitiesForModels()` (src/lib/ollama.ts:346) hit `POST /api/show`, cached per-digest in `chrome.storage.local` under `ollama:cap:<digest>`. `chat()` (src/lib/ollama.ts:532) streams NDJSON off `response.body.getReader()` with a carry-over `buffer` that is flushed once more after the stream closes (src/lib/ollama.ts:609), so a line split across chunks or arriving without a trailing newline is never dropped — verified in isolation against a scratchpad harness before wiring it into the real reader. `toOllamaTool()` (src/lib/ollama.ts:374) defensively falls back to `{type:"object",properties:{}}` when `inputSchema` is missing or not a plain object. Errors are a discriminated `OllamaError` (src/lib/ollama.ts:64, kinds `unreachable-or-cors` | `aborted` | `http` | `invalid-response`) returned via `OllamaResult<T>` from the two request functions, or yielded as a terminal `{type:"error"}` stream event from `chat()` — never thrown as bare strings. Base URL is configurable via `getBaseUrl()`/`setBaseUrl()` (src/lib/ollama.ts:40-49, key `ollama:baseUrl`, default `http://localhost:11434`).

  While reading the full spec I found decisions/04 and decisions/06 (the ones I was pointed at) are now marked Superseded by decisions/09-provider-agnostic-chat-transport.md and decisions/11-provider-capability-detection.md, and the card body itself now frames this file as "the Ollama implementation of the `ChatProvider` interface (card 20)". Card 20 is still in `backlog` with no interface file to import, so I kept this module's own free-function API, but aligned it with the current decisions: `ModelCapabilities.status` is now the three-state `"tool-capable" | "no-tools" | "unknown"` from decision 11 (src/lib/ollama.ts:251-259) instead of a boolean — Ollama itself only ever produces the first two, `"unknown"` exists on the type for the shared contract other providers need. Added `ollamaClient` (src/lib/ollama.ts:633) bundling `listModels`/`getCapabilities`/`chat` as a plain object matching decision 09's `ChatProvider` sketch, so wiring this into card 20's registry later shouldn't require restructuring. `npm run check` (0 errors) and `npm run build` both pass.
