---
status: Accepted
date: 2026-08-19
---
# Decision 10 — Providers are a user-managed registry; API keys stay local

## Context

Multi-provider support (decisions/09-provider-agnostic-chat-transport.md) means a
user can have several provider configs at once — a local Ollama, an OpenAI account,
maybe a second OpenAI-compatible endpoint — and needs a way to add, edit, and remove
them, and to pick which one (and which model) is active. The Ollama-only design never
needed this: there was exactly one implicit provider, configured by a single base-URL
field (decisions/13-options-page-and-settings, now generalized).

Some providers require a secret (an OpenAI API key); Ollama does not. `chrome.storage.sync`
is convenient for small config but is synced to the user's Google account and has
tight per-item (~8KB) and total (~100KB) quotas — not an appropriate place for
secrets, and decision 07 already established the project's posture that
`chrome.storage` here is unencrypted and that should be stated plainly rather than
implied.

## Decision

A provider config is: `{ id, type, name, baseUrl, apiKey?, defaultModel? }`. The list
of provider configs lives in `chrome.storage.sync` **without** the `apiKey` field;
each provider's `apiKey`, if any, is stored separately in `chrome.storage.local`
keyed by provider id. Both are unencrypted at rest, same as session storage
(decisions/07-session-state-and-persistence.md) — stated plainly in the options UI
next to the API key field, not buried in docs.

Provider CRUD (add/edit/remove/reorder, set-default) lives in the options page. The
side panel only *selects* — provider, then model — it never edits the registry.

Exactly one "active provider + active model" pair is tracked as the default; each
tab's session (decisions/07-session-state-and-persistence.md) extends from storing a
bare "selected model" to storing "selected provider id + model", so two tabs can run
different providers concurrently without conflict.

## Consequences

- Removing a provider that a live tab session references leaves that session with a
  dangling provider id — the panel must detect this and prompt for a replacement
  provider rather than silently failing to send.
- API keys never enter `chrome.storage.sync`, so they can't leak to a second synced
  Chrome profile the user didn't intend to hand a credential to; the tradeoff is a
  freshly-signed-in profile must re-enter provider secrets.
- The options page becomes the single place provider host permissions get requested
  from (decisions/09-provider-agnostic-chat-transport.md's `optional_host_permissions`
  flow), since that's now where a provider's base URL is entered.
- Provider config UI needs an explicit empty state (no providers registered) distinct
  from today's "no tool-capable models" empty state, since the two are now separable
  failures.
