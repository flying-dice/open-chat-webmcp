---
status: Accepted
date: 2026-08-20
---
# Decision 21 — Predefined backend presets alongside the custom provider flow

## Context

Adding a provider today
(`src/options/components/ProviderForm.svelte`) asks for a base URL, a type, a
name, an API key and optional headers. That is the right *floor* — decision 09
made the transport provider-agnostic precisely so any OpenAI-compatible endpoint
works — but it is a poor front door. A user who wants Groq has to know Groq's
base URL is `https://api.groq.com/openai/v1`, that it takes a bearer token, and
where to get one. Every hosted backend is the same three facts, and the user has
to supply all three from memory or a browser tab.

Nothing about that is a limitation of the architecture. `ProviderConfig` already
carries everything a preset would fill in; the knowledge is just missing from
the product.

## Decision

Ship a **catalog of presets** in `src/lib/providers/presets.ts`. A preset is
static metadata that pre-fills the existing form — it is not a new provider
type, a new transport, or a new code path:

```ts
interface ProviderPreset {
  id: string;              // stable; stored on ProviderConfig.presetId
  label: string;           // "Groq"
  type: ProviderType;      // reuses the existing "ollama" | "openai"
  baseUrl: string;         // pre-filled, still editable
  requiresKey: boolean;
  local: boolean;          // localhost runtime: no key, localhost permission
  docsUrl: string;         // where to get a key
  note?: string;           // anything surprising about this backend
}
```

The initial catalog: **Ollama**, **LM Studio**, **llama.cpp** (local, no key);
**OpenAI**, **Anthropic**, **Google Gemini**, **OpenRouter**, **Groq**,
**Mistral**, **DeepSeek**, **xAI**, **Together**; and **Custom
(OpenAI-compatible)**, which is today's flow unchanged.

Azure OpenAI is deliberately **excluded**: it addresses a *deployment name*
rather than a model id and requires an `api-version` query parameter, so it does
not fit the common form and would drag conditional fields into it. It remains
reachable through Custom.

"Add provider" becomes: pick a backend, then fill in what that backend actually
needs — usually just a key. `ProviderConfig` gains an optional `presetId` so the
UI can label a provider by its backend, and so a preset's base URL can be
corrected in a later release for users who never edited it.

Every preset field stays editable. A preset is a starting point, never a
constraint — a self-hosted OpenRouter-compatible gateway is still just the
OpenRouter preset with a different base URL.

## Consequences

- Existing stored providers have no `presetId` and are treated as Custom. No
  migration is required and none should be invented; absence is a valid state.
- The catalog is a maintenance surface. Base URLs move and services appear.
  Keeping it static data in one file, with no behaviour attached, is what keeps
  that cost to a line edit.
- Presets must not imply an endorsement or a support guarantee. A listed backend
  is one whose base URL and auth shape we know, nothing more — if it stops being
  OpenAI-compatible, it stops working, exactly as a Custom entry would.
- A preset cannot promise a backend will work from a browser extension. Reaching
  any of them still requires `chrome.permissions.request` for its host from a
  user gesture (decision 10), and a backend that refuses cross-origin requests
  fails the same way it does today
  (`src/lib/providers/openai.ts`'s `unreachable-or-cors`).
- The three local presets point at default ports. A user who moved the port
  edits the field, which is why the field stays editable.
