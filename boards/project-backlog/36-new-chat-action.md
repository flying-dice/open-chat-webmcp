---
column: review
labels: [frontend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T20:51:00.000Z
---
# Start a new chat

"As a user on the chat window I should be able to start a new chat."

DEPENDS ON card 34. Until chats are retained in history, a New Chat button is a
destructive action wearing a friendly label — the previous conversation would be
gone with no way back.

Once history exists this is small: retire the current chat to history, create a
fresh one bound to the current tab, keep the model selection (a user who just
picked a model does not want to pick it again), and put focus in the composer.

## Checklist

- [x] New Chat control in the panel header
- [x] Retires the current chat to history rather than deleting it
- [x] Carries the provider/model selection over to the new chat
- [x] Focus lands in the composer, ready to type
- [x] Sensible behaviour when the current chat is already empty (no empty duplicates)

## Comments

- **claude** (2026-08-19T20:51:00.000Z): Wired straight to the exact seam card 34 left for
  this — `startNewChat(origin)` (panel.svelte.ts:344-354) — via a new "New chat" button
  in Header.svelte's page-row (Header.svelte:61-76), called from App.svelte's
  `handleNewChat` (App.svelte:105-131). Empty-current-chat behaviour: `handleNewChat`
  only calls `startNewChat` when `panel.messages.length > 0`; on an already-empty chat
  it's a no-op except for moving focus, so repeated clicks (or one click right after
  opening the panel) never pile up empty duplicates — verified live: clicking twice on
  a fresh empty chat leaves exactly one chat in storage both times. Also refuses while
  `panel.isStreaming` (both the button's own `disabled` in Header.svelte and a guard in
  `handleNewChat` itself) — swapping the live session mid-stream would silently orphan
  it, since the agent loop's `appendAssistantDelta` looks up the streaming message id
  in whatever session is CURRENTLY loaded, not the one it started against. Selection
  carryover: `startNewChat` already passed `session?.selection` through `createChat`
  before this card; I additionally carry the card-35 `selectionExplicit` flag across
  (panel.svelte.ts:346-349) so a chat that already had a deliberately-chosen model
  doesn't get re-prompted after "New chat" — confirmed live, the picker trigger reads
  the plain provider·model label (not "Confirm ...") immediately after retiring.
  Focus: Composer.svelte exports `focusInput()` (Composer.svelte:130-133) and
  App.svelte holds a `bind:this` ref to call it after `startNewChat` resolves
  (App.svelte:63-64, 126-130) — first component-instance `bind:this` in this codebase
  (everywhere else binds a DOM element), needed because the picker-popover-open state
  precedent (card 35's `selection.pickerOpen`) doesn't apply here — focus is genuinely
  Composer-local DOM state, no reason to lift it into a store. One real bug caught by
  testing rather than reasoning about it: an earlier version persisted the fresh
  chat immediately (to protect the carried-over selection against a panel close before
  the first message) — that made the empty chat show up in the History list right away
  with a "(no messages yet)" placeholder, which is worse than the edge case it
  protected against, so I reverted to leaving it in-memory-only until the first message,
  same as `syncSessionToTab`'s existing fresh-chat behaviour (panel.svelte.ts:316-332).
  Verified the full loop live (Playwright against the built panel, real local Ollama):
  sent a real message, clicked New Chat, transcript reset to 0 messages, picker trigger
  kept the prior model with no re-confirmation prompt, composer got focus, and History
  listed exactly the one retired chat with its 2 messages — no phantom empty entry.
  `npm run check` 0 errors/150 files, `npm run build` green, `npm run verify` 9/9.
