// Host-permission helpers for the provider registry UI (card 22,
// decisions/09-provider-agnostic-chat-transport.md's `optional_host_permissions`
// flow, decisions/10's "options page is where provider host permissions get
// requested from"). The extension only ships `http://localhost/*` and
// `http://127.0.0.1/*` in `host_permissions` (manifest.config.ts); any other
// provider base URL needs a runtime grant via `chrome.permissions.request`
// before it can ever connect — a blocked CORS preflight and a genuinely dead
// server both fail identically as a bare TypeError from `fetch`
// (src/lib/ollama.ts, src/lib/providers/openai.ts), so the only way to make
// "needs permission" visibly distinct from "misconfigured" is to check grant
// state independently of ever attempting a request.

/** Parse a provider's base URL into the origin-only match pattern `chrome.permissions` deals in (`<scheme>://<host>/*`), or `undefined` if the URL doesn't parse. */
export function originPatternForUrl(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return undefined;
  }
}

/**
 * Whether the extension currently holds the host permission a provider's
 * base URL needs. For `localhost`/`127.0.0.1` this resolves `true` without
 * ever prompting, since those origins are already granted at install time
 * via `host_permissions` — `chrome.permissions.contains` reports mandatory
 * permissions as held, so no special-casing of those hosts is needed here.
 */
export async function hasHostPermission(baseUrl: string): Promise<boolean> {
  const pattern = originPatternForUrl(baseUrl);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Request the host permission for a provider's base URL. MUST be called as
 * the first `await` in a click handler — `chrome.permissions.request` only
 * works from an active user gesture, and chaining other async work ahead of
 * it can lose that gesture. Resolves `false` (never throws) both when the
 * user declines the prompt and when the URL doesn't parse into a requestable
 * pattern, so callers can treat "declined" and "unrequestable" the same way:
 * connection cannot proceed, but that's an explicit, visible outcome rather
 * than a silent one.
 */
export async function requestHostPermission(baseUrl: string): Promise<boolean> {
  const pattern = originPatternForUrl(baseUrl);
  if (!pattern) return false;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}
