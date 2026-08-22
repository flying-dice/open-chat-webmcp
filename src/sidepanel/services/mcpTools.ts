// Owns everything about turning configured MCP servers into tools the agent
// loop can call, per decisions/14-backend-mcp-servers.md and
// decisions/19-merging-server-tools-with-page-tools.md. This is the
// sidepanel-side counterpart to src/infra/chrome-runtime/tab-sync.ts: that
// adapter keeps the page's own tool list in step with the worker's registry;
// this one keeps every enabled server's tool list in step with reality,
// off the critical path of any one turn (decisions/19 §4), and exposes the
// per-turn combine step src/sidepanel/services/chatTurn.ts's `ToolExecutor` calls.
//
// CACHING (decisions/19 §4: "Discovery must never block the page"): a
// single module-level cache, refreshed in the background and read
// synchronously by every caller. A turn — or the Tools view — always sees
// "whatever is currently known", never a live network round trip. The cache
// lives only as long as this script context (the side panel's own page),
// same lifetime as src/sidepanel/stores/panel.svelte.ts's view state —
// there is nothing to persist here, a fresh panel just discovers again.
//
// PERMISSION (decisions/19 §4: "reported as unavailable with that specific
// reason, never as a generic failure"): checked via the injected `HostPermissions` port
// BEFORE ever attempting a request, because the transport's own `fetch`
// failure can't tell "no permission" apart from "genuinely unreachable" (a
// blocked CORS preflight and a dead host both reject as a bare TypeError) —
// only a caller that checks out of band, like this one, can report the
// specific reason. See `McpError`'s `"permission"` kind (src/domain/tools),
// added for this.
//
// CREDENTIALS (decisions/15-custom-headers-are-credentials.md): nothing
// here ever reads `config.headers`/`config.auth` directly — only the
// `McpToolGateway` port's `callServerTool`/`discoverAllServerTools` do, and
// their errors (`describeMcpError`) are already scrubbed of
// header/credential values by construction (see that function's own doc
// comment in src/domain/tools). This module only ever forwards that
// already-safe text.
//
// PORTS (cards 76 and 78): everything this module talks to is an INTERFACE
// from src/domain — `McpToolGateway` and `McpServerRegistry`
// (src/domain/tools), `HostPermissions` (src/domain/permissions) — resolved
// through src/sidepanel/app-services.ts, which the composition root wired. It
// names no adapter and constructs nothing. Card 76 left the gateway arriving
// via an interim wiring module; card 78 deleted that module along with this
// file's last two `src/infra` imports.

import {
  buildServerMergedTools,
  combineWithPageTools,
  describeMcpError,
  type MergedTool,
  type MergedToolCallOutcome,
  type McpServerConfig,
  type McpServerDiscovery,
  type McpToolCallResult,
  type McpToolContent,
  type SerializedTool,
} from "../../domain/tools";
import { sidePanelServices } from "../app-services";
import { setServerTools } from "../stores/panel.svelte";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** How long a discovery result is trusted before a background refresh is due again. Not a hard cache-validity boundary — a turn always uses whatever's cached regardless of age (decisions/19 §4); this only paces how often this module bothers re-asking servers that are already known. */
const DISCOVERY_REFRESH_INTERVAL_MS = 60_000;

/** The gateway's own `DEFAULT_CALL_TOOL_TIMEOUT_MS` budget (src/infra/mcp/timeouts.ts) already bounds one `callServerTool` — this module adds no second timeout on top of it, matching the page-tool call path's own single-timeout-per-hop discipline. */


// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  config: McpServerConfig;
  discovery: McpServerDiscovery;
}

let cache: CacheEntry[] = [];
let lastRefreshStartedAt = 0;
let refreshing: Promise<void> | undefined;

/** Every server tool currently known, already namespaced (decisions/19 §1) — everything EXCEPT the current tab's page tools, which only `combineWithPageTools` (called per turn/per read) can add. Synchronous: reads the in-memory cache only, never touches the network. */
function cachedServerTools(): MergedTool[] {
  return buildServerMergedTools(
    cache.map((c) => ({ config: c.config, discovery: c.discovery })),
    executeServerTool,
  );
}

async function refreshNow(): Promise<void> {
  const { mcpServers, mcpTools: gateway, permissions } = sidePanelServices();
  const servers = await mcpServers.listEnabledServers();

  const checks = await Promise.all(
    servers.map(async (config) => ({
      config,
      allowed: await permissions.has(config.url).catch(() => false),
    })),
  );
  const permitted = checks.filter((c) => c.allowed).map((c) => c.config);
  const denied = checks.filter((c) => !c.allowed).map((c) => c.config);

  const discovered = await gateway.discoverAllServerTools(permitted);
  const deniedEntries: McpServerDiscovery[] = denied.map((config) => ({
    status: "error",
    serverId: config.id,
    serverName: config.name,
    error: {
      kind: "permission",
      message: `This extension hasn't been granted permission to reach "${config.name}" (${config.url}) yet — grant it from the options page's MCP Servers section, then try again.`,
    },
  }));

  const byId = new Map(servers.map((s) => [s.id, s] as const));
  cache = [...discovered, ...deniedEntries]
    .map((discovery) => {
      const config = byId.get(discovery.serverId);
      return config ? { config, discovery } : undefined;
    })
    .filter((e): e is CacheEntry => e !== undefined);

  setServerTools(cachedServerTools());
}

/**
 * Kicks a background refresh if one isn't already in flight and the cache is
 * due (or `force`). NEVER awaited by a turn — this is what makes discovery
 * non-blocking (decisions/19 §4): the caller gets whatever's cached right
 * now, and this only ever improves what the NEXT read sees. Safe to call as
 * often as convenient; in-flight refreshes are coalesced to one.
 */
export function ensureMcpDiscoveryFresh(opts?: { force?: boolean }): void {
  if (refreshing) return;
  const now = Date.now();
  if (!opts?.force && now - lastRefreshStartedAt < DISCOVERY_REFRESH_INTERVAL_MS) return;
  lastRefreshStartedAt = now;
  refreshing = refreshNow().finally(() => {
    refreshing = undefined;
  });
}

/**
 * Wires a periodic background refresh for the lifetime of the panel — call
 * once from App.svelte's `onMount`, alongside `initApprovalPolicySync`
 * (card 78 moved the tab sync itself up into src/sidepanel/main.ts, since
 * `chrome.tabs` listeners are a composition-root concern). Returns a cleanup
 * function that stops the
 * interval (the in-flight `refreshNow` promise, if any, is left to settle on
 * its own rather than aborted mid-flight — the gateway's own budgets already
 * bound how long that can take).
 */
export function initMcpToolsSync(): () => void {
  ensureMcpDiscoveryFresh({ force: true });
  const interval = setInterval(() => ensureMcpDiscoveryFresh(), DISCOVERY_REFRESH_INTERVAL_MS);
  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// Per-turn combine (decisions/19 §5) — the one thing chatTurn.ts calls.
// ---------------------------------------------------------------------------

/**
 * The full per-turn tool list: the tab's CURRENT page tools plus whatever
 * server tools are currently cached, namespaced and collision-resolved
 * (decisions/19 §1). Synchronous and network-free — reads the in-memory
 * cache built by the last `refreshNow` — and always kicks a background
 * refresh for the NEXT call, never waits on one now (decisions/19 §4).
 */
export function getMergedToolsForTab(
  pageTools: SerializedTool[],
  callPageTool: (
    toolName: string,
    args: Record<string, unknown>,
    opts: { signal?: AbortSignal },
  ) => Promise<MergedToolCallOutcome>,
): MergedTool[] {
  ensureMcpDiscoveryFresh();
  return combineWithPageTools(cachedServerTools(), pageTools, callPageTool);
}

// ---------------------------------------------------------------------------
// Server tool execution — the ServerToolExecutor bound into every server
// MergedTool by buildServerMergedTools above.
// ---------------------------------------------------------------------------

/** Joins every text-bearing content part of an MCP tool result into one display/model-readable string — mirrors src/domain/chat/turn.ts's own `stringifyResult`'s "always produce plain text/JSON, never anything evaluated" discipline, extended to MCP's richer content-part shape. Non-text parts (image/audio/resource) are summarized by kind + mimeType rather than dropped silently, so nothing about what the tool returned disappears without a trace. */
function contentToText(content: McpToolContent[]): string {
  const parts = content.map((part) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "resource":
        return part.resource.text ?? `[resource: ${part.resource.uri}]`;
      case "resource_link":
        return `[resource link: ${part.name ?? part.uri}]`;
      case "image":
        return `[image: ${part.mimeType}]`;
      case "audio":
        return `[audio: ${part.mimeType}]`;
    }
  });
  return parts.join("\n\n");
}

/** The display/model-facing payload for a successful (`isError: false`) call — structured content when the tool declared one, else the joined text content. */
function successResult(result: McpToolCallResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  return contentToText(result.content);
}

/**
 * The {@link ServerToolExecutor} every server `MergedTool.call` closes over
 * (config, toolName) for. Never throws; always resolves the same
 * `{ok,result}`/`{ok,error}` shape src/domain/chat/turn.ts
 * already speaks for page tools, so `executeToolCall` there needs no
 * per-kind branching (decisions/19 §5).
 *
 * `isError: true` (the gateway's doc: "the tool's OWN reported failure" —
 * still a protocol-level success) is folded into the `{ok:false}` path
 * here, same as a page tool's own thrown/rejected execution already
 * surfaces as `{ok:false}` — from the agent loop's and the transcript's
 * point of view, "the tool ran and reported failure" and "the call itself
 * failed" both just mean this call didn't succeed.
 */
async function executeServerTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal },
): Promise<MergedToolCallOutcome> {
  // Re-checked at call time, not just at discovery time: permission can be
  // revoked between one turn's discovery snapshot and this call (another
  // options tab, or the user reacting mid-conversation) — decisions/19 §4's
  // "specific reason" requirement applies here too, not just to discovery.
  const { mcpTools: gateway, permissions } = sidePanelServices();
  const allowed = await permissions.has(config.url).catch(() => false);
  if (!allowed) {
    return {
      ok: false,
      error: `This extension no longer has permission to reach "${config.name}" (${config.url}) — grant it from the options page's MCP Servers section and try again.`,
    };
  }

  const result = await gateway.callServerTool(config, toolName, args, { signal: opts.signal });
  if (!result.ok) {
    return { ok: false, error: describeMcpError(result.error) };
  }
  if (result.value.isError) {
    return { ok: false, error: contentToText(result.value.content) || "The server reported an error for this call." };
  }
  return { ok: true, result: successResult(result.value) };
}
