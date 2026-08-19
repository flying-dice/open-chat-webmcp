---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T21:49:00.000Z
---
# Side panel chat shell

The Svelte app itself: header with provider/model picker and connection state, the
transcript, and the composer. Built on the tokens from card 06 and responsive
down to ~320px.

The provider/model picker itself is scoped in card 23
(decisions/11-provider-capability-detection.md).

## Checklist

- [x] App shell: header / transcript / composer layout, panel-width responsive
- [x] Build the header slot card 23 mounts the provider/model picker into
- [x] Connection status indicator wired to a placeholder state (card 20/23 wires the real source)
- [x] Current page indicator (title, origin, tool count)
- [x] Composer: multiline, Enter to send, Shift+Enter newline, stop button while streaming
- [x] Message list with user / assistant / tool-card roles
- [x] Autoscroll that yields when the user scrolls up

## Comments

- **claude** (2026-08-19T15:32:00.000Z): Descoped after cards 20-24 landed. The picker moved to card 23 and the connection indicator now hangs off the `ChatProvider` abstraction (card 20) rather than the Ollama client directly, so this card is the shell and transcript only.
- **claude** (2026-08-19T16:55:00.000Z): Built the shell. State lives in a new thin in-memory store, `src/sidepanel/stores/panel.svelte.ts:1-40` (see its SWAP NOTE doc comment for exactly which mutators card 12's `session.ts` replaces — did not import `session.ts` itself, per scope). Tab/tool sync is isolated to `src/sidepanel/services/activeTab.ts:1-129`, which asks the worker for tools via `runtime:get-tools` (src/lib/protocol.ts) and resets the transcript on active-tab switch or cross-origin navigation, matching the sw.ts navigation-clears-registry gate. UI: `src/sidepanel/components/Header.svelte:1-40` (page indicator + connection dot + a typed `picker` snippet prop as the card-23 slot contract, with a placeholder chip fallback), `src/sidepanel/components/Transcript.svelte:1-60` (autoscroll: pins to bottom while `atBottom`, a scroll listener is the sole source of truth for that flag, and a "Jump to latest" pill appears the instant the user scrolls away — see file header comment), and `src/sidepanel/components/Composer.svelte:1-40` (Enter sends/Shift+Enter newline/IME-safe, Stop button swaps in while streaming). Wired `src/sidepanel/main.ts:2` to import `../lib/theme.css` (was dead code before this card). Verified with `npm run check` (0 errors), `npm run build`, and a Playwright pass against the built panel at 320px in light/dark plus a seeded-store run exercising markdown rendering, tool cards, and the scroll-up/jump-to-latest flow — all screenshots discarded after review, no test harness added (card 25's job).
- **claude** (2026-08-19T21:49:00.000Z): The shell this card built is restructured by cards 48/49 (decisions/18): the header keeps only a title and icon actions, the page indicator and connection dot move to a context chip above the composer, the provider/model picker moves into the composer, and the view switcher is replaced by a kebab overflow menu. Every behavioural contract this card established is preserved rather than rebuilt — the autoscroll rule and the `atBottom` single-source-of-truth invariant (src/sidepanel/components/Transcript.svelte:74-103), Enter/Shift+Enter with the IME guard (src/sidepanel/components/Composer.svelte:95-102), the exported `focusInput` (:115-117), and card 35's five blocked-composer states (:71-85). One latent bug in the shell was fixed on the way past: `handleRetry` read an in-memory `lastSentText` that is empty after a panel reload, so Retry silently did nothing on a restored session (src/sidepanel/App.svelte:196-211).
