---
status: Accepted
date: 2026-08-19
---
# Decision 12 — Project and extension are branded "OpenChat (WebMCP)"

## Context

The project and repo started life as "Ollama WebMCP" / `ollama-webmcp-chrome`,
back when decisions/04-ollama-transport.md hardcoded the chat transport to a
local Ollama server. Decision 09 generalized the transport to a provider-agnostic
`ChatProvider` interface (cards 20-23 add a provider registry and an OpenAI
Chat Completions client), so the extension no longer talks to Ollama
exclusively. Card 24 already tracks sweeping "Ollama"-only wording once that
work ships; that sweep needs a target name to sweep *to*.

## Decision

The project and the Chrome extension are branded **"OpenChat (WebMCP)"**:

- "OpenChat" is the product name — a chat UI that works against any
  OpenAI-compatible or Ollama-compatible provider, not tied to one backend.
- "(WebMCP)" is kept as a parenthetical qualifier identifying the mechanism
  (page-embedded WebMCP tools driven from the side panel), since that's the
  distinguishing feature versus a generic chat extension.
- The manifest `name` field, the options page title, and marketing/store
  copy use "OpenChat (WebMCP)"; internal identifiers (npm package name,
  repo slug) use a kebab-case derivative, `openchat-webmcp`.

## Consequences

- `package.json` `name`/`description` and `manifest.config.ts`'s `name` field
  move from `ollama-webmcp-chrome` / "Ollama WebMCP" to `openchat-webmcp` /
  "OpenChat (WebMCP)" — tracked as part of card 24's naming sweep (now
  retargeted at this name) and card 19's store listing.
- The repo directory/remote name is *not* renamed by this decision — that's a
  separate, riskier operation (breaks clone URLs/bookmarks) left to the user's
  discretion.
- Icons, screenshots, and any README badges that embed the old name need
  refreshing wherever "Ollama WebMCP" appears verbatim.
- Ollama stays a first-class provider (it's why "WebMCP" is still in the
  name's mechanism qualifier); this is a rename, not a de-scoping of Ollama
  support.

Superseded by: none.
