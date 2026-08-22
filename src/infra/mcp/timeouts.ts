// Every timeout budget this adapter spends, in one place (card 76; the
// numbers themselves are unchanged from src/lib/mcp/client.ts and
// src/lib/mcp/oauth.ts).
//
// A deliberate, separate ladder from the extension's existing
// bridge(20s) < relay(25s) < worker(30s) < panel(35s) cross-context chain
// (src/content/relay.ts, src/background/sw.ts,
// src/sidepanel/services/agentLoop.ts). That chain times a same-machine
// message relay across JS worlds; these time a network round trip to a
// third-party server the extension does not control, so they get their own
// numbers rather than being squeezed into it:
//
//   - Connect/list operations (handshake + a directory lookup) get a short
//     budget: a remote MCP server that cannot complete an `initialize` and a
//     `tools/list` within 10s is unlikely to ever be pleasant to wait on,
//     and this runs once per server on every tool-list refresh — it should
//     fail fast so a dead server does not visibly stall the merged tool list.
//   - `tools/call` gets a longer budget, deliberately close to the existing
//     ladder's OUTERMOST (worker) rung of 30s: a remote tool invocation is
//     comparable in kind to a page tool call — the agent loop waits on it the
//     same way — so it should get comparable patience before this adapter
//     gives up, rather than an arbitrarily different number.
//
// Before this file, the OAuth half carried its own copy of the 10s number
// with a comment explaining that importing the client's constant would have
// created an import cycle. That reason is gone (both halves now live in this
// one adapter and both import THIS file), but the two constants stay
// separate all the same: they coincide at 10s by judgement, not by
// definition, and a future change to how long a token exchange may take
// should not silently retune every handshake.

/** Budget for `testServerConnection`: initialize handshake only. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Budget for a standalone `listServerTools` call: initialize + `tools/list` (with pagination). */
export const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 10_000;

/** Per-server budget inside `discoverAllServerTools`: same handshake + list-tools work as {@link DEFAULT_LIST_TOOLS_TIMEOUT_MS}, given a couple of extra seconds of headroom since it is competing for the event loop with every other server being discovered concurrently. */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 12_000;

/** Budget for `callServerTool`: initialize + one `tools/call`. Deliberately close to src/background/sw.ts's `CALL_TIMEOUT_MS` (30_000) — see the module doc. */
export const DEFAULT_CALL_TOOL_TIMEOUT_MS = 30_000;

/** Budget for a single OAuth discovery/registration/token request (./oauth-http.ts). Not derived from {@link DEFAULT_CONNECT_TIMEOUT_MS} — see the module doc. */
export const OAUTH_REQUEST_TIMEOUT_MS = 10_000;
