---
status: Superseded
date: 2026-08-19
---
# Decision 06 — Only tool-capable models are selectable; the rest are shown disabled

> Superseded by decisions/11-provider-capability-detection.md, which keeps this
> decision's picker UX but generalizes detection from Ollama's `/api/show` to a
> provider-supplied `getCapabilities` with a third "unknown" state.

## Context

`/api/tags` lists every model pulled locally, but many of them (embedding
models, older or smaller chat models) have no tool-calling support. Picking one
produces a chat that silently ignores every page tool — the model answers from
its own knowledge and the WebMCP integration appears broken. That is the flakiest
possible first impression.

Ollama's `/api/show` reports a `capabilities` array that includes `"tools"` for
models that support function calling.

## Decision

Query `/api/show` for each installed model and use `capabilities.includes("tools")`
to partition the picker.

Models without tool support are **listed but disabled** — greyed out and
unselectable, with an inline reason ("no tool-calling support"). They are not
hidden: a user who has just pulled a model needs to see it in the list and
understand *why* it cannot be picked, rather than wonder whether the extension
failed to detect it.

Capability results are cached in `chrome.storage.local` keyed by model digest,
since `/api/show` is one request per model and the answer only changes when a
model is re-pulled.

No prompted-JSON fallback for non-tool models — explicitly rejected. It is
unreliable on exactly the small models that would need it and would reintroduce
the flakiness this decision exists to remove.

## Consequences

- Every selectable model can actually drive the page. No silent no-tool chats.
- The picker doubles as an explanation of the user's local model library.
- First load pays N `/api/show` requests; these are issued concurrently and
  cached thereafter.
- If a user has *no* tool-capable model, the panel must say so directly and
  suggest a concrete `ollama pull` (e.g. a current tool-capable model) rather
  than presenting an empty picker.
