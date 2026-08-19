---
status: Superseded
date: 2026-08-19
---
# Decision 04 — Ollama is called from the side panel; the worker is only a broker

> Superseded by decisions/09-provider-agnostic-chat-transport.md, which generalizes
> this decision's transport ownership from Ollama specifically to any registered
> `ChatProvider`.

## Context

Someone has to hold the HTTP connection to Ollama and stream tokens. Either the
background service worker or the side panel page can do it, and both are
extension contexts with host permissions.

MV3 service workers are terminated after ~30s idle. An in-flight `fetch` keeps
one alive, but the worker can still be recycled around long generations, and
piping a token stream worker → panel means re-broadcasting every chunk over
`chrome.runtime` messaging.

## Decision

The **side panel** owns the Ollama connection. It calls `/api/tags`,
`/api/show`, and `/api/chat` directly and consumes the NDJSON stream from
`response.body.getReader()` straight into the UI.

The **service worker** never talks to Ollama. Its jobs are: opening the panel,
keeping the per-tab tool registry, and relaying tool calls between the panel and
the content relay.

Host permissions ship as `http://localhost/*` and `http://127.0.0.1/*`, with
`optional_host_permissions` for `http://*/*` and `https://*/*` so a remote or
LAN Ollama can be granted from the options page at runtime.

## Consequences

- Streaming is a direct read loop with no cross-context chunk relay — simplest
  and lowest latency path to tokens on screen.
- **Closing the side panel aborts an in-flight generation.** Accepted for v1;
  the request is tied to the panel's lifetime via an `AbortController`.
- **CORS:** Ollama rejects `chrome-extension://` origins unless configured. The
  user must set `OLLAMA_ORIGINS=chrome-extension://*` (or the specific extension
  id) and restart the server. A failed preflight is indistinguishable from
  "server down" in `fetch`, so the connection check must name this explicitly
  and link the fix rather than reporting a generic network error.
- Default base URL is `http://localhost:11434`.
