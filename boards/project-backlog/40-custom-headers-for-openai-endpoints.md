---
column: review
labels: [frontend, backend]
priority: high
agent: claude
updatedAt: 2026-08-19T00:00:00.000Z
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

- [x] Header key/value pairs on provider configs, add/edit/remove
- [x] Values stored local-only and masked, like the API key
- [x] Sent on every request from the OpenAI-compatible client
- [x] Reserved headers refused at edit time with a clear reason
- [x] Connection test exercises the real headers
- [x] Values excluded from call log, inspector and any error text
- [x] Storage note in options covers headers, not just the key

## Comments

- **claude** (2026-08-19T00:00:00.000Z): Implemented per decisions/15. Config shape: `ProviderConfig.headers?: ProviderHeader[]` (`{key, value}[]`, `ProviderHeader` at src/lib/provider.ts:45) added additively, plus a shared `reservedHeaderReason()` check at src/lib/provider.ts:71. Threaded through src/lib/providers/registry.ts's CRUD — the whole array (keys+values) lives in `chrome.storage.local` under `providers:headers:<id>` (registry.ts:56, :113-134), never `chrome.storage.sync`; `addProvider`/`updateProvider`/`removeProvider` route it exactly like `apiKey`. Wire sending: src/lib/providers/openai.ts's `buildHeaders` (openai.ts:130) applies custom headers first then sets `Content-Type`/`Accept`/`Authorization` last (case-insensitive `Headers.set`) so client-controlled values always win even if a reserved header reached config directly — used by both `listModels` (openai.ts:201, header build at :211) and `chat` (openai.ts:505, header build at :527). Extended the same shared `headers` field to the Ollama client too (src/lib/ollama.ts:253 `buildHeaders`, threaded into `listModels`/`getCapabilities`/`chat` opts at :313/:383/:431/:537; src/lib/providers/ollama.ts:122-124) since it fell out cleanly from the shared `ProviderConfig` shape and a user may run Ollama behind a gateway — `Authorization` is never reserved there (Ollama has no API-key concept). Reserved-header/duplicate checks surface inline, per row, as the user types in src/options/components/ProviderForm.svelte (`HeaderRow` at :81, `headerRowError`/`firstHeaderError` at :109/:130, header UI at :315); submit and "Test connection" both block on the first violation before building a request. Values are masked by default (type="password", global show/hide toggle); ProviderRow.svelte:75 shows only a header *count* badge, never values. Storage note updated in both ProviderForm.svelte:370 and ProvidersSection.svelte:149 to cover header values, not just the API key. Verified with a standalone harness (compiled the real modules via `tsc`, ran against two local echo HTTP servers plus a chrome.storage mock, in /private/tmp/.../scratchpad/verify-ts/harness.cjs) — 39/39 assertions pass: headers reach the wire for both clients, `Content-Type`/`Accept`/`Authorization` always win over a smuggled config value, custom `Authorization` survives when no API key is set, sync storage never contains a header value or the apiKey, and error results (including a dead-server network failure) never contain a header value or apiKey. Also confirmed live against the real local Ollama server (7 models, request succeeded with a custom header attached). `npm run check` (0/144), `npm run build`, and `npm run verify` (9/9) all green.
