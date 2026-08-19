---
column: review
labels: [frontend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T20:51:00.000Z
---
# Force an explicit model selection before chatting

"As a user on the chat window I should be forced to select the model."

Today a selection can resolve implicitly from a stored default, so it is possible
to start typing without ever having consciously chosen what will answer — and,
worse, without noticing that the resolved model cannot call tools
(decisions/11-provider-capability-detection.md).

Require a deliberate choice before the first message of a chat. Remembering that
choice for subsequent chats is fine; silently inheriting one that was never made
is not.

Blocking the composer is the mechanism, so the empty state has to do real work:
say what is needed and route to the picker in one click. A disabled input with no
explanation is a worse experience than the implicit default it replaces.

## Checklist

- [x] Composer disabled until a provider + model is explicitly selected
- [x] Clear inline prompt that routes to the picker, not a bare disabled box
- [x] A remembered previous choice counts as explicit; an unconfirmed default does not
- [x] Interaction with a dangling provider (card 23) — treat as unselected
- [x] Does not fight the no-providers-registered empty state from card 14

## Comments

- **claude** (2026-08-19T20:51:00.000Z): `ChatSession` (src/lib/session.ts, out of scope for this card) has no field
  that distinguishes "the user clicked a model" from "the store silently seeded the
  stored default" — both round-trip as the identical `{providerId, model}` shape, and
  I can't widen that type from src/sidepanel/**. Fixed it the way `PanelMessage`
  already extends `ChatMessage` (panel.svelte.ts's own header comment): one extra
  `selectionExplicit` boolean persisted alongside `selection` on the session object,
  not part of `ChatSession`'s declared type but round-tripped fine by
  `chrome.storage.local` and `isChatSession`'s validator (it only checks the fields it
  declares). `setSessionSelection` (panel.svelte.ts:394-455) now takes an `explicit`
  flag: `false` from `syncToTab`'s default-seed (selection.svelte.ts:201-208 — this is
  literally the "resolve implicitly from a stored default" path the card names), `true`
  from the picker's `selectModel` (selection.svelte.ts:394-412) and the new
  `confirmSelection` (selection.svelte.ts:414-427). A chat saved before this shipped
  reads back `undefined`, which `panel.selectionExplicit` (panel.svelte.ts:264-274)
  treats as not-explicit — the safer reading where the data can't say either way, per
  the card's own instruction: better a one-time forced confirmation on old chats than
  silently trusting an implicit default forever. One boundary this can't close from
  src/sidepanel/**: the options page's "Set as default" star
  (src/options/components/ProvidersSection.svelte:100-103) writes the global default
  without going through the capability-checked picker flow at all — that default gets
  the same `explicit: false` treatment the first time a new chat auto-seeds from it, so
  it still gets a one-click confirmation rather than being trusted blindly, but this is
  a genuine gap for whoever owns src/options/** to know about.
  `selection.needsConfirmation` (selection.svelte.ts:157-164) is what actually gates
  the composer, not `resolution.status === "ok"` alone. Composer.svelte's `blocked`
  derivation (Composer.svelte:35-63) branches into five distinct empty states so the
  no-providers case (routes to options, per card 14/23's existing wording) never gets
  confused with the needs-a-model case (routes to the picker) — `no-providers`/
  `providers-error` open options; `unselected` (resolution `"none"` or `"dangling"` —
  card 23's dangling case explicitly counts as unselected) opens the picker in one
  click via the new shared `selection.pickerOpen`/`openPicker` (selection.svelte.ts:
  111-119, 429-441, lifted out of ProviderPicker.svelte's local state so Composer can
  open the SAME popover instance mounted in the header); `needs-confirmation` shows a
  direct one-click "Use {provider} · {model}" button (`confirmSelection`) plus a
  "Change" link into the picker, for the case where the resolved model is already
  right and just needs a nod. Verified the whole loop live against this machine's real
  local Ollama (Playwright driving the built panel): picking a model unblocks the
  composer immediately; clearing this tab's `tabchat:*` pointer to simulate a brand-new
  chat auto-seeding from the now-set default correctly re-blocks it as
  "Confirm Local Ollama · llama3.1:latest" (ProviderPicker.svelte:94-101 also flags this
  on the trigger chip, not just in the composer); one click on "Use ..." unblocks it
  again without changing provider/model. `npm run check` 0 errors/150 files, `npm run
  build` green, `npm run verify` 9/9 (screenshots at verify/output/screenshots/). Also
  had to fix `.picker__trigger`'s `max-width` (ProviderPicker.svelte:301-309) from a
  flat 160px to `min(160px, 100%)` — at 320px it was overflowing past its actual
  (correctly shrunk) parent once card 36's "New chat" button and longer "Confirm ..."
  labels started competing for header width; caught via direct `getBoundingClientRect`
  inspection against the built extension, not just the screenshot.
