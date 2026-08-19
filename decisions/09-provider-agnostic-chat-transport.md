---
status: Accepted
date: 2026-08-19
---
# Decision 09 — Chat transport is provider-agnostic; the side panel still owns the connection

## Context

Decision 04 hardcoded the chat transport to Ollama's REST API
(`/api/tags`, `/api/show`, `/api/chat`) called directly from the side panel, with the
service worker acting only as a broker for tool calls. The project now needs to
support more than one chat backend — starting with OpenAI's Chat Completions API,
and any OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, local servers that
mimic the OpenAI wire format) — with more providers addable later.

The reasoning behind decision 04 (MV3 service worker idle-termination risk, no
cross-context chunk relay needed) is unrelated to which provider is talking; it holds
regardless of backend.

## Decision

Keep the side panel as the owner of the HTTP/streaming connection. Generalize what it
connects to: a `ChatProvider` client interface —

```
listModels(): Promise<Model[]>
getCapabilities(model): Promise<Capabilities>
chat({ model, messages, tools, signal }): AsyncIterable<StreamEvent>
```

— instantiated against a provider config (type, base URL, optional API key). The
side panel resolves the active provider config, builds the matching client, and
streams straight into the UI exactly as before; only the client behind that
interface changes per provider (Ollama: NDJSON; OpenAI Chat Completions: SSE).

The service worker's role is unchanged: open the panel, keep the per-tab tool
registry, relay tool calls between the panel and the content relay. It still never
talks to a chat backend directly.

Host permissions generalize the same way: `http://localhost/*` and
`http://127.0.0.1/*` remain baked in for local Ollama, and
`optional_host_permissions` (`http://*/*`, `https://*/*`) continues to cover any
other provider host — `api.openai.com`, a custom OpenAI-compatible host, or a remote
Ollama — granted at runtime from the options page per provider. MV3 extension pages
with a granted host permission are not subject to CORS preflight blocking, so this
covers cloud providers the same way it already covered non-localhost Ollama.

## Consequences

- Adding a provider means writing one `ChatProvider` implementation; nothing about
  the panel's streaming/UI loop changes.
- **Closing the side panel still aborts an in-flight generation**, for every
  provider — the request is tied to the panel's lifetime via `AbortController`
  regardless of which client issued it.
- Each client is responsible for translating its own wire format (NDJSON vs. SSE,
  tool-call shape, error shapes) into the shared `StreamEvent`/tool-call
  representation the agent loop consumes — the agent loop and panel stay
  provider-agnostic.
- CORS/auth failure modes are now per-provider: Ollama's is "server rejects the
  extension origin," OpenAI's is "missing/invalid API key" (401) — each client must
  surface its own failure as a distinct, named state rather than a generic network
  error, same requirement decision 04 already placed on the Ollama client.
- Supersedes decisions/04-ollama-transport.md.

Superseded by: none.
