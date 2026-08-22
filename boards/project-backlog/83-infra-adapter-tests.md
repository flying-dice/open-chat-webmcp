---
column: todo
labels: [infra, backend]
priority: med
updatedAt: 2026-08-22T13:50:00.000Z
---
# Infra adapter tests

Cover the driven adapters at the level decisions/30-vitest-test-pyramid.md
prescribes: exercise the real technology cheaply with an in-memory
`chrome.storage` fake and a stubbed `fetch`, and assert that platform failures map
into the domain error vocabulary. The adapters under test are the chrome-storage
repositories (the chat store that replaced session.ts's ~24 storage sites, both
registries with their sync/local credential split, the settings store), the Ollama
NDJSON client and the OpenAI SSE client, and `infra/mcp`'s OAuth refresh path. No
network and no real `chrome` object anywhere in this suite.

## Checklist

- [ ] shared test helpers: an in-memory `chrome.storage` fake with separate `sync` and `local` namespaces, `onChanged` events, `lastError` injection and simulated quota exhaustion; plus a `fetch` stub that can serve fixed bodies, streamed chunks, HTTP errors and hangs
- [ ] chat repository round-trips: `chat:<id>`, `chat:index` and `tabchat:<tabId>` write-read-delete, index mutations serialized under concurrent writers, the 400-chat eviction backstop, and the debounced flush writing once rather than per keystroke
- [ ] credential split asserted directly: after saving a provider and an MCP server, the `sync` namespace holds only `providers:list`, `providers:default` and `mcp:servers:list` — no API key, header value or OAuth token — while the matching `local` keys hold them
- [ ] error mapping: quota exceeded, `chrome.runtime.lastError`, an absent key and malformed stored JSON each surface as the domain storage error vocabulary with the cause retained, never as a raw platform error
- [ ] Ollama adapter: NDJSON stream parsing with a chunk split mid-line, a trailing partial line, the done sentinel and a garbage line; capability probing over a stubbed `/api/show`; HTTP 403 (origin rejection) and 500 mapped to the right `ProviderError` variants
- [ ] OpenAI adapter: SSE parsing with multi-line `data:` frames, `[DONE]`, comment/keepalive lines, a frame split across chunks, and tool-call deltas assembled across frames; 401 and 429 mapped to `ProviderError`
- [ ] `infra/mcp`: `getValidAuth` across valid, near-expiry, expired-with-successful-refresh and refresh-rejected, each persisting through the injected token store rather than the registry; and the never-throws `McpResult` contract holding under transport failure and a non-JSON body
- [ ] npm run check, npm test, npm run build and npm run verify green
