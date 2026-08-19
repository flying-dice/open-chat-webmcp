---
status: Accepted
date: 2026-08-20
---
# Decision 22 — The composer's model picker is one flat, grouped list

Refines card 23's two-level picker. [decisions/18](18-side-panel-material-expressive.md)
established *where* the picker lives; this decides *how it behaves*.

## Context

Decision 18 moved the provider/model picker out of the header and into the
composer's action row, on the reasoning that which model answers is a property
of the message you are about to send. That placement is right and stays.

The interaction did not follow. The picker is still the two-level control card 23
built for the header: a provider `<select>` at level one, then that provider's
model list at level two. Switching from a local Ollama model to a hosted one is
two decisions and a re-render, and there is no way to see everything available at
once. Both references the product is aimed at — Gemini's picker and VS Code
Chat's — present a single list and let the user pick a model, with the provider
as context rather than a gate.

## Decision

**One list, opened from a compact chip in the composer's action row.**

The chip shows the current model id alone, truncated, with a chevron — not
"provider / model". The provider is visible in the list; the chip is a status,
and the model is what the user thinks in.

List order, top to bottom:

1. **Selectable models, grouped under a heading per provider.** A provider with
   no selectable models contributes no heading. The current selection is marked.
2. **"Unverified"** — `unknown` capability (decision 11). Selectable, with the
   picker's existing inline reason.
3. **"No tool support"** — `no-tools`. Disabled, with its reason. Never hidden:
   decision 06's rule is that a model is shown and explained, not silently
   omitted.

Rows in groups 2 and 3 carry their provider as secondary text, since they are no
longer under a provider heading.

A **filter input** appears at the top once the total row count passes a small
threshold, and is skipped below it — a filter box over four models is noise.
Filtering matches model id and provider name.

A **"Manage providers…"** action pins to the bottom and opens the options page.
This is the picker's only affordance for changing configuration; adding and
editing providers stays in options (decision 10), it does not move into the
panel.

Capability state is resolved through
`src/lib/providers/capability.ts` — the shared module card 41 extracted — so the
picker and the options page cannot drift on what counts as selectable.

The selection remains per-tab and persisted exactly as today (decision 07,
card 35's explicit-selection rule). This decision changes presentation and
interaction only; nothing about what a selection *means* changes.

## Consequences

- Every model from every configured provider is fetched to populate one list,
  where the two-level picker only fetched the browsed provider's. Model lists
  must load per provider, in parallel, degrading per provider: one unreachable
  backend greys its own group and never blocks the others. This is the same
  degrade-per-source discipline decision 19 §4 applies to MCP servers.
- With many providers the list is long. That is what the filter is for, and why
  disabled models sort to the bottom rather than interleaving.
- Losing the provider `<select>` removes the only place the UI stated a
  provider's connection error prominently. Those errors have to surface on the
  provider's group heading instead, or they disappear.
- A model id alone can be ambiguous across providers (two backends both serving
  `llama3`). The group heading disambiguates in the list; the chip may not. The
  chip is a reminder, not an identifier — the full pair stays available on hover
  and in the options page.
