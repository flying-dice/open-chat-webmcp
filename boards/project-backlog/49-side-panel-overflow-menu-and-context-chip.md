---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T21:49:00.000Z
---
# Side panel IA: kebab overflow menu, in-place views, context chip

Recent chats, the tool inspector and settings move into a kebab overflow menu;
the permanent Chat / Tools & Log / History switcher goes away; the page
indicator, connection state and tool count fold into a context chip above the
composer. See decisions/18-side-panel-material-expressive.md.

Depends on card 48 for the tokens and icon primitives.

## Checklist

- [x] `OverflowMenu.svelte` with an in-place submenu behind a "Back" row, click-outside/Esc
- [x] Recent chats (top 5 via `listChatSummaries`), active row in `--color-secondary-container`
- [x] "More" row opens the full History view
- [x] `SegmentedControl` removed from `App.svelte` (retained inside `Inspector`)
- [x] History / Inspector render full-bleed with a Back row; composer hidden
- [x] `ContextChip.svelte` above the composer; connection status + tool count fold in
- [x] `PageInfo.favIconUrl` plumbed from `activeTab.ts`
- [x] `src/sidepanel/lib/chatTitle.ts` shared by the header, the menu and the history list
- [x] Menu geometry verified at exactly 320px
- [x] Verify harness: 320/400 x light/dark, plus menu-open and model-sheet shots

## Comments

- **claude** (2026-08-19T21:49:00.000Z): Built the IA. The menu is src/sidepanel/components/OverflowMenu.svelte:1-176 — rows are full-bleed (the active one is tinted `--color-secondary-container` and clipped to the menu's radius by `overflow: hidden` at :192), the settings submenu replaces the menu's contents in place behind a Back row rather than flying out sideways, and the width is `min(--menu-width, 100vw - 16px)` at :186 because a 335px menu does not fit a 320px panel. Recent chats are re-listed on open, not kept live — `listChatSummaries` reads `chat:index` only, and a closed menu has nothing to keep fresh. The header (src/sidepanel/components/Header.svelte:1-107) is now one row on the page background with a title and two icon buttons; everything it used to carry moved to src/sidepanel/components/ContextChip.svelte:1-100, where the connection state rides as a dot on the tab's favicon rather than occupying a row of its own. Titles come from src/sidepanel/lib/chatTitle.ts:1-60, derived from the first user message (`ChatSummary.preview` already holds it) — no schema change, no migration, and the header, the menu and the history list all call the same truncator so a chat is never called two different things. `PageInfo.favIconUrl` added at src/sidepanel/stores/panel.svelte.ts:182-188 and plumbed at src/sidepanel/services/activeTab.ts:162 and :208-219 (a favicon can arrive after the title, as a bare update with no URL change). Deliberate deviation, recorded in decision 18: the reference's dismiss X on the context chip detaches the shared tab, and we have no detach concept — an X that left `attachTools` (src/sidepanel/App.svelte:190) alone would claim to stop sharing the page while page tools carried on being offered, so the chip opens the inspector instead.
- **claude** (2026-08-19T21:49:00.000Z): Rebuilt the screenshot harness, which was showing nothing useful. Opened as a plain tab (MV3 panels can't be opened programmatically), `chrome.tabs.query` returns the panel's OWN tab, whose `chrome-extension://` URL activeTab.ts correctly classifies as restricted — so every previous shot was of the restricted state. verify/checks/screenshots.mjs:116-150 now stubs `chrome.tabs` and `runtime:get-tools` via `addInitScript`, and seeds real `ChatSession`/`chat:index`/provider records BEFORE the app mounts (:151-166 — doing it inside the init script races the stores' initial load and loses). Matrix is now 320/400 x light/dark plus the two anchored surfaces that no ordinary screenshot can catch, since both dismiss on any outside click: the open overflow menu and the open model sheet. Verified at exactly 320px — the tool count drops out of the chip below 360px by design, the model chip and send button still fit, and the menu clamps without clipping.
