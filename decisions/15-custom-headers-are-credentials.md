---
status: Accepted
date: 2026-08-20
---
# Decision 15 — Custom request headers are treated as credentials

## Context

Provider configs currently carry an optional API key, sent as a bearer token
(decision 10). Real deployments often sit behind a gateway that wants something
else: an `x-api-key`, a tenant or project header, a proxy authorization, a
Cloudflare Access service token pair. Without arbitrary headers, those endpoints
are simply unreachable.

The same is true of remote MCP servers (decision 14).

## Decision

Provider configs — and MCP server configs — accept a user-defined set of custom
request headers, sent on every request to that endpoint.

Header VALUES are treated exactly like the API key: stored in
`chrome.storage.local`, never written to `chrome.storage.sync`, and masked in the
UI. It is not safe to assume a header value is non-sensitive; the common cases are
credentials by definition.

Headers the client controls for correctness are reserved and cannot be overridden
by a custom header: `Authorization` when an API key is set for that config, and
the `Content-Type` and `Accept` values the wire format requires. A user-supplied
`Authorization` is allowed only when no API key is configured, so there is exactly
one thing setting it.

## Consequences

- Options-page storage of secrets grows beyond a single field, so the plain-language
  note about unencrypted local storage must cover headers too, not just the key.
- A misconfigured header can produce failures that look like server bugs. The
  connection test must send the custom headers, so testing exercises the real
  request rather than a simpler one that would pass when the real one fails.
- Reserved-header conflicts need to be refused visibly at edit time rather than
  silently dropped at request time.
- Header values must never be logged into the call log or the inspector.
