---
column: todo
labels: [infra, frontend]
priority: med
updatedAt: 2026-08-22T13:55:00.000Z
---
# Component tests over fake ports

Add the component tier of decisions/30-vitest-test-pyramid.md:
`@testing-library/svelte` (Svelte 5) + `jsdom`, driving components over fake ports
with no real background worker in the loop. Today the UI has effectively zero
automated regression coverage — the verify harness opens the side panel HTML as a
plain control tab and drives `chrome.*` directly, bypassing the Svelte UI by
design. Cover the behaviour-heavy components rather than the presentational ones:
Composer.svelte (294), ApprovalCard.svelte (295), Transcript.svelte (409),
OverflowMenu.svelte (247 — its `onOpenHistory`/`onOpenTools`/`onOpenChat`
callbacks are the panel's entire navigation API, since the view is local `$state`
at App.svelte:53), ProviderPicker.svelte (759), and the two options forms.

## Checklist

- [ ] `@testing-library/svelte` + `jsdom` wired into the vitest config as a second project/environment so `src/domain` tests keep running in plain `node`; a shared render helper injects fake ports
- [ ] Composer.svelte: Enter sends, Shift+Enter inserts a newline, empty and whitespace-only input cannot send, and the send control becomes stop while a turn is active and calls the stop handler
- [ ] ApprovalCard.svelte: approve / deny / skip each fire their callback once; full keyboard operation (focus order, Enter/Space activation); a decided card cannot be submitted twice
- [ ] Transcript.svelte: autoscroll stays pinned while the view is at the bottom, unpins when the user scrolls up, and jump-to-latest re-pins; notices and approval cards render inline in the right position
- [ ] OverflowMenu.svelte: each menu item fires the matching navigation callback, and the recent-chats rows pass the chat id through — this is the whole nav API, so a silent break here loses history and tools
- [ ] ProviderPicker.svelte: the grouped flat list renders its groups, an entry without tool capability is not selectable, and selecting emits the provider+model pair
- [ ] options `ProviderForm.svelte` and `McpServerForm.svelte`: required-field and URL validation, submit blocked while invalid, the masked API key never echoed back into the DOM, and header rows added/removed — all over fake registry and auth ports, zero `chrome.*`
- [ ] npm run check, npm test, npm run build and npm run verify green
