// Shared host-permission helpers for any remote-endpoint registry in this
// extension (decisions/09-provider-agnostic-chat-transport.md's
// `optional_host_permissions` flow; decisions/14-backend-mcp-servers.md:
// "Reaching a server's host requires `chrome.permissions.request` from a
// user gesture, exactly as a remote provider does"). The extension only
// ships `http://localhost/*` and `http://127.0.0.1/*` in `host_permissions`
// (manifest.config.ts); any other endpoint needs a runtime grant via
// `chrome.permissions.request` before it can ever connect — a blocked CORS
// preflight and a genuinely dead server both fail identically as a bare
// TypeError from `fetch` (src/lib/ollama.ts, src/lib/providers/openai.ts,
// src/lib/mcp/client.ts), so the only way to make "needs permission"
// visibly distinct from "misconfigured" is to check grant state
// independently of ever attempting a request.
//
// This was originally written once for the provider registry (card 22,
// as src/options/lib/permissions.ts) and copied verbatim for the MCP
// registry (card 37, as src/lib/mcp/permissions.ts) because src/options/
// was off-limits to that card at the time. Card 37 flagged the duplication
// explicitly as something that belongs shared once both land — this is
// that consolidation: one implementation, generic over "a URL whose host
// needs a permission grant", re-exported from both original locations so
// neither side's imports had to change.

/** Parse a URL into the origin-only match pattern `chrome.permissions` deals in (`<scheme>://<host>/*`), or `undefined` if the URL doesn't parse. */
export function originPatternForUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return undefined;
  }
}

/**
 * Whether the extension currently holds the host permission a URL's origin
 * needs. For `localhost`/`127.0.0.1` this resolves `true` without ever
 * prompting, since those origins are already granted at install time via
 * `host_permissions` (manifest.config.ts) — `chrome.permissions.contains`
 * reports mandatory permissions as held.
 */
export async function hasHostPermission(url: string): Promise<boolean> {
  const pattern = originPatternForUrl(url);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Request the host permission for a URL's origin. MUST be called as the
 * first `await` in a click handler — `chrome.permissions.request` only
 * works from an active user gesture, and chaining other async work ahead of
 * it can lose that gesture. Resolves `false` (never throws) both when the
 * user declines the prompt and when the URL doesn't parse into a requestable
 * pattern, so callers can treat "declined" and "unrequestable" the same way:
 * connection cannot proceed, but that's an explicit, visible outcome rather
 * than a silent one.
 */
export async function requestHostPermission(url: string): Promise<boolean> {
  const pattern = originPatternForUrl(url);
  if (!pattern) return false;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}
