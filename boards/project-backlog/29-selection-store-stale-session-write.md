---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T22:05:00.000Z
---
# Selection store can overwrite a session with stale history

Found and flagged by the agent-loop card (08), which could not fix it — the file
belongs to card 23's scope.

`src/sidepanel/stores/selection.svelte.ts` holds its OWN copy of the tab's
`ChatSession` so that `selectModel()` can persist the chosen `{providerId, model}`.
Meanwhile the agent loop appends messages to the session through
`src/sidepanel/stores/panel.svelte.ts`, which is now a live view over
`ChatSession.messages` (card 08's session swap).

So two holders of the same session exist, and only one of them sees new messages.
Change provider or model mid-conversation and `selectModel()` writes back its older
snapshot, dropping any messages appended since the selection store last loaded it.

The symptom is quiet and easy to miss: the conversation on screen still looks right
until the panel is closed and reopened, at which point the messages that were
written over are gone.

Prefer eliminating the duplicate copy over trying to keep two copies in sync —
a single owner of the session object, with the selection store persisting only the
selection field, is the fix that stays fixed. Whatever approach is taken, the
invariant to preserve is that no writer may persist a session it did not just read.

## Checklist

- [x] Establish a single owner for the in-memory `ChatSession`
- [x] `selectModel()`/`selectProvider()` persist the selection without rewriting history
- [x] Cover it: switch model mid-conversation, reload, assert no messages lost
- [x] Re-check the same hazard for the dangling-provider replacement path

## Comments

- **claude** (2026-08-19T20:05:00.000Z): Reproduced the loss first, before touching any source: a scratch harness (mirroring `src/lib/session.ts`'s real `getOrCreateSession`/`saveSession` mechanics) loaded two independent copies of one tab's session, pushed a message through one and saved it, then wrote a selection through the other — reload showed 0 messages, confirming the clobber. Fix: `src/sidepanel/stores/panel.svelte.ts` is now documented and treated as the sole in-memory owner of `ChatSession` (module doc comment `src/sidepanel/stores/panel.svelte.ts:44-54`), and gets two new exports, `getSessionSelection`/`setSessionSelection` (`src/sidepanel/stores/panel.svelte.ts:218-242`), that read/write the `selection` field on that same live object — never a copy. `src/sidepanel/stores/selection.svelte.ts` no longer loads or holds a `ChatSession` at all: its private `session` state var is gone, `syncToTab` (`src/sidepanel/stores/selection.svelte.ts:176-212`) resolves the tab's selection via `getSessionSelection` + the registry's `resolveSelection` directly (no `ChatSession` needed for that), and `selectModel` (`src/sidepanel/stores/selection.svelte.ts:349-366`) persists through `setSessionSelection` instead of writing back a locally cached snapshot. This relies on `panel.svelte.ts` having already loaded the tab's session by the time the picker syncs to it, which holds for its one caller — `activeTab.ts`'s `refreshActiveTab` always awaits `syncSessionToTab` before setting `pageInfo`, and `ProviderPicker.svelte` only calls `syncToTab` off a `pageInfo` change — so `getSessionSelection`/`setSessionSelection` no-op harmlessly rather than lie if that's ever not true. The dangling-provider replacement path goes through this exact same `selectModel()` (no separate write path exists for it — see the doc comment added at `src/sidepanel/stores/selection.svelte.ts:338-342`), so it's covered by the same fix. Re-ran the scratch harness against the single-owner pattern: message and selection both survive. `npm run check` (0 errors) and `npm run build` both green. Harness lives at `/private/tmp/claude-501/-Users-jonathanturnock-Projects-ollama-webmcp-chrome/a56e867f-1fd2-4a9e-9bef-d1a1e2866feb/scratchpad/repro.ts` (scratch only, not committed).
- **claude** (2026-08-19T22:05:00.000Z): Renumbered 27 -> 29 to clear a collision with the incoming `27-storefront-page-design` card. Content unchanged; see the note on card 28 for the full remap.
