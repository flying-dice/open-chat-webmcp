---
status: Accepted
date: 2026-08-24
---
# Decision 40 — Page context: selected text and page content, explicitly shared

## Context

The extension reads pages exclusively through the tools they publish
(decisions/02/16; docs/03's privacy story is built on it). Jonathan wants
proper access to the page itself — its content and the user's selected
text — like Gemini's Chrome panel, where a "Selected text" chip attaches
to the composer and the panel shows a visible "Sharing <page>" state. Most
pages publish no tools, so today the panel is blind on them; this is the
single biggest product capability gap.

## Decision

Page context becomes a first-class, **explicitly indicated** input:

- **Selected text**: when the user has a selection in the active tab, the
  composer offers it as a dismissible chip (pulled on demand — at panel
  focus and at send — never streamed continuously). Sending with the chip
  attaches the selection to that turn.
- **Page content**: a per-chat "Share page" affordance (context-chip
  action) includes a text extraction of the page with the turn. Extraction
  is a dependency-free DOM walk in the relay (readability-lite: main text,
  headings, links' text — no scripts/styles), size-capped with a visible
  truncation note.
- **Transport**: two new pull messages over the existing relay/worker
  protocol (single-sourced message list per card 79's mechanism). The
  relay stays the only page-touching code.
- **Privacy posture** (amends docs/03, keeps its spirit): nothing leaves
  the page without a user-visible artifact — the chip on the composer and
  a persisted transcript marker recording that context was shared with
  that turn. No auto-sharing, no background reads; pulls happen only on
  the user gestures above. Restricted pages behave as today.
- **Trust**: page context is untrusted content — fenced in the prompt
  exactly like tool results (decision 17's fencing), never interpolated as
  instructions.
- **Domain shape**: a PageContext value (selection and/or extract +
  metadata) carried on the turn options; persisted on the transcript as a
  context marker (kind + params per decision 38, localized at render).

## Consequences

- The extension becomes useful on every page, not only WebMCP ones — a
  significant product surface change reflected in README/docs and the
  store-listing copy when card 117 runs.
- New strings ship in all ten locales; the verify scenario pack gains a
  selection flow against the demo page.
- Token budgeting: page extracts are capped (with the cap stated in the
  truncation note) so a huge page cannot drown the model context.
- docs/03-privacy-and-trust.md is updated in the same phase — the
  only-what-pages-publish claim becomes only-what-you-visibly-share.
