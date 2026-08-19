---
status: Accepted
date: 2026-08-19
---
# Decision 11 — Tool-capability detection is provider-supplied; the UX stays the same

## Context

Decision 06 detected tool-calling support per model via Ollama's `/api/show`
`capabilities` array. That mechanism is Ollama-specific: OpenAI's API exposes no
equivalent per-model "does this support function calling" field, and other future
providers can't be assumed to either.

The UX principle behind decision 06 — never hide a model, disable it with a reason —
was motivated by user confusion when a freshly-added model silently vanished from the
picker, not by anything Ollama-specific. That principle should hold across providers.

## Decision

`getCapabilities(model)` moves onto the `ChatProvider` interface
(decisions/09-provider-agnostic-chat-transport.md); each client backs it however
fits:

- **Ollama**: unchanged — live `/api/show` per model, `capabilities.includes("tools")`,
  cached in `chrome.storage.local` keyed by model digest.
- **OpenAI Chat Completions**: no capability API exists, so the client ships a
  maintained static allowlist of known tool-calling model IDs. A model not on the
  list resolves to an explicit **"capability unknown"** state — distinct from
  "confirmed no tool support" — rather than guessing either way.

The picker keeps decision 06's partitioning UX: confirmed-no-tools models stay
listed and disabled with an inline reason; "capability unknown" models are also
listed, disabled by default, with a different inline reason ("tool support not
verified for this model") rather than being silently treated as safe.

The prompted-JSON fallback for non-tool models remains explicitly rejected, for the
same reliability reason decision 06 gave.

## Consequences

- Every provider client must classify each model into one of three states —
  tool-capable, confirmed no tools, unknown — rather than a boolean; the picker UI
  needs a third visual/inline-reason treatment for "unknown."
- The OpenAI allowlist is a maintenance burden: new tool-capable OpenAI models won't
  auto-enable until the list is updated, so a model can sit in "unknown" until then.
  Acceptable tradeoff versus guessing wrong and producing a silently-ignored-tools
  chat, which is the exact failure decision 06 was written to prevent.
- Ollama's mechanism is unchanged in behavior; only its type signature moves onto the
  shared interface.
- Supersedes decisions/06-tool-capable-models-only.md.

Superseded by: none.
