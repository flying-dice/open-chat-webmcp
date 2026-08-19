---
column: todo
labels: [frontend, backend]
priority: high
updatedAt: 2026-08-20T10:30:00.000Z
---
# Custom headers on OpenAI-compatible endpoints

"As a user of the configuration panel I should be able to add custom headers to
the openapi compatible api endpoint so that I can hit authenticated gateways."

Implements decisions/15-custom-headers-are-credentials.md. Without this, any
endpoint behind a gateway wanting `x-api-key`, a tenant/project header, a proxy
authorization, or a Cloudflare Access service-token pair is simply unreachable —
a bearer token is not enough.

Header VALUES are credentials by default, not configuration: stored in
`chrome.storage.local` like the API key, never in `chrome.storage.sync`, masked in
the UI, and never written to the call log or inspector.

Reserved headers must be refused visibly at edit time rather than dropped silently
at request time: `Authorization` while an API key is set, plus the `Content-Type`
and `Accept` values the wire format depends on. A user-supplied `Authorization` is
allowed only when no API key is set, so exactly one thing controls it.

The connection test must send the custom headers, or it will pass while real
requests fail — which is worse than having no test.

## Checklist

- [ ] Header key/value pairs on provider configs, add/edit/remove
- [ ] Values stored local-only and masked, like the API key
- [ ] Sent on every request from the OpenAI-compatible client
- [ ] Reserved headers refused at edit time with a clear reason
- [ ] Connection test exercises the real headers
- [ ] Values excluded from call log, inspector and any error text
- [ ] Storage note in options covers headers, not just the key
