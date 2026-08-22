---
column: todo
labels: [backend, infra]
priority: high
updatedAt: 2026-08-24T11:00:00.000Z
---
# Make the adapter tests realistic: real HTTP, real flows

The infra suites stub global fetch with hand-built Response objects —
fast, but they never exercise real connection behaviour, chunked encoding,
header casing, keep-alive, or abort propagation. Upgrade realism where it
buys confidence, per decisions/30:

- A tiny in-process HTTP test server helper (node:http, per-test port)
  serving real NDJSON (ollama), real SSE (openai + MCP streamable/legacy)
  with genuine chunk boundaries, delays, mid-stream socket destruction,
  and real status/header handling. Port the failure-matrix tests that
  currently fake ReadableStream chunks onto it; KEEP pure parser unit
  tests where they're sharper (judge per test; journal the split).
- Real abort: AbortController → socket teardown asserted server-side.
- runAuthorizationFlow (flagged untested since card 94): cover the full
  interactive flow against a local auth server (metadata, registration,
  authorize redirect, token exchange, refresh) with a fake
  chrome.identity.launchWebAuthFlow driving the redirect — including
  user-cancelled and expired paths.
- The MCP transport suites' 401-mid-call and fallback logic re-proven
  against the real server helper.

## Checklist

- [ ] HTTP test-server helper landed (shared, typed, torn down per test) and adopted by ollama/openai/mcp transport suites where realism wins; split judgment journalled
- [ ] Abort propagation asserted against real sockets
- [ ] runAuthorizationFlow fully covered incl. cancel/expiry; card 94's flag closed
- [ ] Suite runtime stays sane (journal before/after npm test durations)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green
