// Host-permission grant state as a RULE plus a PORT (card 78,
// decisions/29-ddd-hexagonal-typescript-layout.md).
//
// The extension only ships `http://localhost/*` and `http://127.0.0.1/*` in
// `host_permissions` (manifest.config.ts). Any other endpoint — a remote
// Ollama, an OpenAI-compatible gateway, an MCP server, or an OAuth
// authorization server discovered from one — needs a runtime grant before it
// can ever be reached (decisions/09, decisions/14). That matters to the user
// interface specifically because a blocked CORS preflight and a genuinely
// dead host both fail identically as a bare `TypeError` from `fetch`
// (src/infra/ollama/client.ts, src/infra/openai, src/infra/mcp/budget.ts), so
// the ONLY way to make "needs permission" visibly distinct from
// "misconfigured" is to check grant state out of band, before attempting a
// request.
//
// Two halves, split along the layer line:
//
//   `originPatternForUrl` is the RULE — "which origin pattern does this URL's
//   host need, and is it a kind of URL that can be granted at all". Pure
//   string/URL work, no platform, unit-testable in bare Node.
//
//   `HostPermissions` is the PORT — asking for, and watching, the actual
//   grant. Implemented once, in src/infra/chrome-runtime/permissions.ts, over
//   `chrome.permissions`. Nothing outside that adapter names `chrome`.
//
// Why its own bounded context rather than a member of `providers` or `tools`:
// both of those need it, identically, and neither owns it — a host permission
// is about an ORIGIN, not about what the extension intends to say to it. It
// sits alongside `src/domain/storage` (the shared error vocabulary) as a
// small context other contexts and the surfaces depend on.

/**
 * Parse a URL into the origin-only match pattern a browser permission model
 * deals in (`<scheme>://<host>/*`), or `undefined` when the URL doesn't parse
 * or isn't an http/https URL — the two cases a caller must treat the same
 * way: this endpoint can't be reached, and no prompt would help.
 */
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
 * The driven port for host-permission grants. Every method is total and
 * never throws: an unrequestable URL, a declined prompt and a platform error
 * all resolve `false`, so a caller can treat "declined" and "unrequestable"
 * the same way — connection cannot proceed, but that is an explicit, visible
 * outcome rather than a silent one.
 */
export interface HostPermissions {
  /**
   * Whether the extension currently holds the grant `url`'s origin needs.
   * `localhost`/`127.0.0.1` resolve `true` without ever prompting, since
   * those origins are already held at install time via the manifest's
   * mandatory `host_permissions`.
   */
  has(url: string): Promise<boolean>;

  /**
   * Ask for the grant `url`'s origin needs.
   *
   * MUST be the first `await` in a click handler: a browser only honours a
   * permission request from an active user gesture, and chaining other async
   * work ahead of it can lose that gesture. Resolves `false` when the user
   * declines and when the URL is unrequestable.
   */
  request(url: string): Promise<boolean>;

  /**
   * Call `listener` whenever a grant is added or removed — including from
   * outside this extension's own UI (a user revoking one from the browser's
   * extensions page). Returns a teardown that removes the subscription.
   */
  onChanged(listener: () => void): () => void;
}
