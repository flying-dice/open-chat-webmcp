// The two request shapes the OAuth flow makes, and how their failures map
// into the domain's `McpError` (card 76; moved unchanged from
// src/lib/mcp/oauth.ts).
//
// Kept separate from ./json-rpc.ts because these are not JSON-RPC at all: a
// well-known metadata GET and a form-encoded token POST, whose failure
// vocabulary differs from a JSON-RPC endpoint's (notably RFC 6749 §5.2's
// `error`/`error_description` body becoming `kind: "auth"`).

import type { McpError, McpResult } from "../../domain/tools";
import { isRecord } from "./json-rpc";
import { OAUTH_REQUEST_TIMEOUT_MS } from "./timeouts";

export function classifyFetchError(err: unknown): McpError {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { kind: "timeout", message: `Timed out after ${OAUTH_REQUEST_TIMEOUT_MS}ms during OAuth discovery/token exchange.` };
  }
  if (err instanceof TypeError) {
    return {
      kind: "unreachable",
      message:
        "Could not reach the authorization server. Either the host is down, or this extension hasn't been granted permission to talk to it yet.",
    };
  }
  return { kind: "invalid-response", message: err instanceof Error ? err.message : String(err) };
}

/** GET `url` and parse the body as JSON. Used for the two well-known metadata documents — never a POST, never form-encoded. */
export async function fetchJson(url: string): Promise<McpResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: classifyFetchError(err) };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { kind: "not-mcp-endpoint", message: `${url} responded ${response.status} ${response.statusText}.` },
    };
  }
  try {
    return { ok: true, value: await response.json() };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        message: `${url} did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/** POST `application/x-www-form-urlencoded` `body` to a token endpoint and parse the JSON response, classifying a non-2xx per RFC 6749 §5.2's standard `error`/`error_description` shape as `kind: "auth"` (the same kind an expired bearer token produces) rather than the generic HTTP-failure kinds {@link fetchJson} uses for metadata GETs. */
export async function postToken(tokenEndpoint: string, body: URLSearchParams): Promise<McpResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: classifyFetchError(err) };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const errCode = isRecord(json) && typeof json.error === "string" ? json.error : undefined;
    const description = isRecord(json) && typeof json.error_description === "string" ? json.error_description : undefined;
    return {
      ok: false,
      error: {
        kind: "auth",
        status: response.status,
        message:
          description ??
          (errCode ? `Token request failed: ${errCode}` : `Token endpoint responded ${response.status} ${response.statusText}.`),
      },
    };
  }
  if (json === undefined) {
    return { ok: false, error: { kind: "invalid-response", message: "Token endpoint did not return valid JSON." } };
  }
  return { ok: true, value: json };
}
