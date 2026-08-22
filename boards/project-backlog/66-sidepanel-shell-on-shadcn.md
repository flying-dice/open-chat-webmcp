---
column: review
labels: [frontend]
priority: high
agent: claude-sonnet-a
live: false
updatedAt: 2026-08-22T15:10:00.000Z
---
# Side-panel shell on shadcn-svelte

Migrate the side panel's shell to shadcn-svelte components per
decisions/28-shadcn-svelte-maia-zinc.md, keeping the exact screen structure
and flows: Header (inline-renameable title, icon actions, kebab), the
OverflowMenu (recent chats + More, tools inspector, settings), the
chat/inspector/history view switch with its Back subview bar, and the
overall column layout of App.svelte. Same behaviours, new components.

Components in scope: App.svelte (layout + subview bar only — leave
handleSend etc. alone), Header.svelte, OverflowMenu.svelte (→
DropdownMenu), IconButton.svelte + Tooltip.svelte (→ Button
variant="ghost" size="icon" + shadcn Tooltip), SegmentedControl.svelte (→
Tabs), Icon.svelte (→ Hugeicons for standard glyphs; keep sparkle + Ollama
marks as local SVGs, shrinking src/lib/icons.ts accordingly). Delete each
component's <style> block as it migrates; no new custom CSS.

Keep accessible names/roles stable ("More options" menu button, menuitem
roles) — verify/checks/screenshots.mjs locates UI by them; update that file
in this card if a name must change.

## Checklist

- [x] Header, OverflowMenu, IconButton/Tooltip, SegmentedControl, Icon migrated; scoped CSS removed
- [x] App.svelte shell layout on Tailwind utilities; view switching and Back bar behave identically
- [x] Inline title rename still works (focus, commit on Enter/blur)
- [x] Hugeicons replace Material Symbols paths for standard glyphs; icons.ts reduced to custom marks
- [x] Overflow menu keyboard navigation intact (arrow keys, Escape)
- [x] Screenshot-check selectors still match (or updated in verify/checks/screenshots.mjs)
- [ ] npm run check, npm run build and npm run verify green — check + build run green by me (see Comments); verify NOT run here on purpose (collides with parallel agents in this tree per my brief) — coordinator runs it after the batch

## Comments

- **claude-sonnet-a** (2026-08-22T15:10:00.000Z): Migrated the side-panel shell to shadcn-svelte per decisions/28. Icon.svelte (src/sidepanel/components/Icon.svelte:1-121) is now a thin wrapper: `sparkle`/`ollama` still render inline SVG paths from src/lib/icons.ts:1-99 (shrunk to just those two, per the card), every other name renders via `@hugeicons/svelte`'s `HugeiconsIcon` off a name→Hugeicons lookup table at Icon.svelte:57-88. `IconName` in src/lib/icons.ts:56-89 is now an explicit union (`CustomIconName | StandardIconName`) rather than derived from `iconPaths`' keys, so it still type-checks for every out-of-scope consumer (Transcript.svelte, ActivityIndicator.svelte, src/lib/providers/presets.ts) without them changing at all — `Icon`'s and `IconButton`'s public `name`/`icon` prop API is unchanged.
  Icon mapping table (old Material Symbols name → Hugeicons export, all from `@hugeicons/core-free-icons`): air→WindIcon, alt_route→Route02Icon, arrow_back→ArrowLeft01Icon, arrow_downward→ArrowDown01Icon, arrow_upward→ArrowUp01Icon, bolt→FlashIcon, build→Wrench01Icon, check→Tick02Icon, check_circle→CheckmarkCircle02Icon, chevron_right→ArrowRight01Icon, close→Cancel01Icon, content_copy→Copy01Icon, delete→Delete02Icon, diamond→Diamond02Icon, edit_square→PencilEdit02Icon, expand_more→ArrowDown01Icon, explore→Compass01Icon, group→UserGroupIcon, hexagon→HexagonIcon, info→InformationCircleIcon, more_horiz→MoreHorizontalIcon, more_vert→MoreVerticalIcon, open_in_new→LinkSquare02Icon, public→Globe02Icon, refresh→Refresh01Icon, settings→Settings02Icon, smart_toy→RoboticIcon, stop→StopIcon, subject→TextAlignLeftIcon, terminal→TerminalIcon, widgets→GridViewIcon.
  IconButton.svelte (src/sidepanel/components/IconButton.svelte:1-127) is now shadcn's `Button` (`variant="ghost"`, `size="icon"`/`"icon-sm"`) with shadcn's Tooltip wired straight onto the button via bits-ui's `child` snippet (not through the generic Tooltip.svelte wrapper — see below). `tone`+`variant="filled"` now map onto Button's own solid variants (`primary`→`default`, `danger`→`destructive`, plain filled→`secondary`) instead of ad-hoc colour overrides. Public props unchanged (icon, label, onclick, disabled, tooltip, tooltipPlacement, tone, variant, size, title) — verified against every consumer (Composer.svelte, MessageActions.svelte, HistoryListItem.svelte, NoticeCard.svelte, Transcript.svelte all stayed untouched and still compile).
  Tooltip.svelte (src/sidepanel/components/Tooltip.svelte:1-46) now wraps bits-ui's Tooltip.Root/Trigger/Content+Provider (one Provider per instance — simplest, and Provider only shares a `delayDuration` nothing here needs). Its `child` snippet attaches the trigger's merged props to a `display:contents` wrapping span around `children`, not to `children` itself — documented in the file why: `focus`/`blur` don't bubble, so a genuinely focusable trigger needs the wiring directly on itself. That's exactly why IconButton.svelte does its OWN Tooltip.Trigger wiring rather than reusing this component — this generic wrapper is right for MessageActions.svelte's non-focusable "Copied" badge (its only remaining out-of-scope consumer) but would silently lose the keyboard-focus tooltip on something interactive.
  OverflowMenu.svelte (src/sidepanel/components/OverflowMenu.svelte:1-149) is now shadcn's DropdownMenu (Root/Trigger/Content/Item/Label/Separator). The kebab trigger is composed directly (Button+Icon via the `child` snippet) rather than via IconButton, for the same "props must land on the real button" reason as Tooltip. Recent-chat rows, "More", the divider, "Tools & call log", "Open options" and the read-only connection-status line are unchanged in content/order; `DropdownMenu.Item`'s `onSelect` replaces the old manual `close(); action();` pairing (bits-ui auto-closes on select). Arrow-key/Home/End/type-ahead roving focus now comes for free from bits-ui — the old hand-rolled version only had Escape + click-outside wired, so this is a strict superset, not a regression.
  SegmentedControl.svelte (src/sidepanel/components/SegmentedControl.svelte:1-31) is now shadcn's Tabs (Root/List/Trigger), value/onSelect passed one-way (no `bind:value`) — confirmed via bits-ui's tabs.svelte.js that `onValueChange` fires on every selection change regardless of binding, so Inspector.svelte's existing `value`+`onSelect` usage needed no change.
  Header.svelte (src/sidepanel/components/Header.svelte:94-129) and App.svelte (src/sidepanel/App.svelte:292-388) lost their `<style>` blocks entirely (Header) / down to none (App) — pure Tailwind utility classes now, including App.svelte's composer-dock/context-chip flush-join rule, kept as an inline arbitrary-variant selector (`[&>.context-chip+.composer]:mt-0` etc., App.svelte:344-346) since it targets classnames owned by out-of-scope sibling components (ContextChip.svelte/Composer.svelte) that Tailwind utilities alone can't reach.
  Accessible names unchanged: "More options" (OverflowMenu's trigger), "New chat" (Header), "Back to chat" (App.svelte), "Chat name" (rename input), menuitem role on every DropdownMenu.Item — verify/checks/screenshots.mjs needed no changes (checked every selector it uses against the new markup by hand).
  Gates: `npm run check` — 0 errors (810 files). `npm run build` — green, dist/ produced normally. Did NOT run `npm run verify` per my brief (parallel agents in this tree); the coordinator should run it after the batch lands. I did not launch the extension in a live browser either, for the same collision-avoidance reason — recommend the coordinator's verify pass (which includes verify/checks/screenshots.mjs) as the first live check of this card's actual rendering.
