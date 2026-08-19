---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-20T09:00:00.000Z
---
# Flatten the composer's model picker into one grouped list

Decision 18 moved the picker into the composer's action row, which is right and
stays. The interaction did not follow: it is still card 23's two-level control —
a provider `<select>`, then that provider's models. Switching from a local model
to a hosted one is two decisions, and nothing shows what is available at once.

Target is the Gemini / VS Code Chat model: one list, provider as context rather
than a gate.

See [decisions/22](../../decisions/22-flat-model-picker.md).

## Scope

`src/sidepanel/components/ProviderPicker.svelte` and
`src/sidepanel/stores/selection.svelte.ts`.

**The chip** shows the current model id alone, truncated, with a chevron. Not
"provider / model" — the provider belongs in the list.

**The list**, in this order:

1. Selectable models, grouped under a per-provider heading. A provider with no
   selectable models contributes no heading.
2. "Unverified" — `unknown` capability, selectable, with the existing inline
   reason. Rows carry their provider as secondary text.
3. "No tool support" — `no-tools`, disabled, with its reason. Never hidden;
   decision 06 requires a model be shown and explained rather than omitted.

**Filter input** at the top, appearing only once the total row count passes a
small threshold — a filter box over four models is noise. Matches model id and
provider name.

**"Manage providers…"** pinned at the bottom, opening the options page. That is
the picker's only configuration affordance; adding and editing providers stays
in options.

**The real work is in the store, not the markup.** `selection.svelte.ts`
currently loads models for the *browsed* provider only. It now needs every
configured provider's models, loaded in parallel and degrading per provider: one
unreachable backend greys its own group and must never block or fail the others.
This is the same discipline decisions/19 §4 applies to MCP server discovery —
read how `src/sidepanel/services/mcpTools.ts` does it and follow that shape.

Losing the provider `<select>` removes the only place a provider's connection
error was stated prominently. Surface it on that provider's group heading or it
disappears — check what `selection.modelsState`'s `error` branches currently
render (`unreachable-or-cors` with its `fix` copy, `auth`, `not-supported`,
manual-entry fallback) and make sure each still has a home. The manual-model-entry
path for backends with no `/v1/models` must survive too.

Capability state comes from `src/lib/providers/capability.ts` (card 41's shared
module) so the picker and options page cannot drift.

Selection stays per-tab and persisted exactly as today (decision 07, card 35's
explicit-selection rule). Presentation changes; what a selection means does not.

Match decisions/18's design system — compose `Icon`/`IconButton`/`Tooltip` and
the existing sheet/popover patterns rather than hand-rolling markup.

## Checklist

- [ ] Chip shows the model id alone, truncated, with a chevron
- [ ] One list: per-provider groups, then Unverified, then No tool support
- [ ] Disabled rows keep their inline reason and sort to the bottom
- [ ] Filter appears only past a threshold; matches model id and provider
- [ ] All providers' models load in parallel, degrading per provider
- [ ] Per-provider connection errors surface on the group heading
- [ ] Manual-model-entry path still reachable
- [ ] "Manage providers…" opens options
- [ ] Keyboard: filter, arrow, enter, escape; click-outside still closes

## Comments
