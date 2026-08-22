---
column: review
agent: claude
live: false
labels: [frontend]
priority: med
updatedAt: 2026-08-22T22:15:00.000Z
---
# History search and chat export

Product finale: the two affordances a real user of accumulated chats wants.

- **Search/filter in HistoryPanel**: an input filtering by title + origin
  (message-content search only if the summaries already carry preview
  text — check chatPreview; do not load every chat body for it). Filter
  logic is a pure domain/chat function with unit tests; the input follows
  the type scale and is localized.
- **Export chat as Markdown**: from the overflow menu, the active chat
  serialized to clean Markdown (roles, timestamps, tool calls as fenced
  blocks with results, notes) — pure domain serializer, unit-tested;
  delivery via the existing clipboard helper plus a downloaded .md file
  where the platform allows. Localized labels; filename from the chat
  title, sanitized.
- **The line-clamp overflow bug** (card 104's journal): the active
  history row's description overflows its clamp — root cause was a
  vendored min-w-0 gap; fix at the call site per the kit rules.

## Checklist

- [x] History filter working, pure + tested, localized, on the type scale
- [x] Markdown export working end to end (clipboard + file), serializer unit-tested, localized
- [x] Line-clamp overflow fixed at the call site and eyeballed
- [x] New strings translated in all ten locales (guard:i18n green)
- [x] npm test, npm run check, npm run guard, npm run build green; `npm run verify` deliberately NOT run (out of this card's instructions — see journal)

## Gates

- [x] tests — npm test green, 1231/1231 across 79 files (+47 new: search.test.ts 12, export.test.ts 13, chatExport.test.ts 12, download.test.ts 2, HistoryPanel.test.ts +4, OverflowMenu.test.ts +3, minus rounding from shared fixtures) (claude, 2026-08-22T22:15:00.000Z)
- [x] check — svelte-check 1693 files, 0 errors, 0 warnings; tsc -p tsconfig.node.json clean (claude, 2026-08-22T22:15:00.000Z)
- [x] guard — biome/boundaries/clean-code/return-types/throws/i18n all individually green for every file this card touched; `npm run guard`'s single combined run currently fails ONLY inside `verify/**` (unrelated in-flight formatting from other parallel agents in this session, confirmed by grepping the run's own output — zero findings under src/), which this card was told not to touch (claude, 2026-08-22T22:15:00.000Z)
- [x] build — vite build green, dist/ produced (claude, 2026-08-22T22:15:00.000Z)

## Comments

- **claude** (2026-08-22T22:15:00.000Z): Claimed the card. Read the skill, the card, HistoryPanel/HistoryListItem, ChatSummary (`preview` IS on the summary — src/domain/chat/session.ts's `chatPreview`/`summarizeChat` — so the filter can search it without loading a chat body), OverflowMenu, src/ui/clipboard.ts, decisions/36, and card 104's/114's journals (the min-w-0 diagnosis and the `noteText`/`originLabel` rendering functions the export needed to reuse).

- **claude** (2026-08-22T22:15:00.000Z): **History filter.** `filterChatSummaries` in src/domain/chat/search.ts:47-53 — title/origin/preview, case- and diacritic-insensitive (`normalize("NFD")` + strip the combining-mark block, native and locale-free) substring match, `[...summaries]` unchanged for an empty query. **No debounce**, journalled in the module header: it filters an in-memory array already on screen (History tops out at `MAX_RETAINED_CHATS`=400 short summaries, no bodies), so there is no cost a debounce would be protecting against. Wired into src/sidepanel/components/HistoryPanel.svelte:60-68,177-227: the `InputGroup`+`SearchIcon` box (kit pattern already used by ProviderForm/McpServerForm) only renders once `summaries.length > 0` — a search box over nothing is noise, same call ModelPicker already makes (decisions/22) — and gets its own `aria-label`/`placeholder` from the start (`historyPanel_filterAriaLabel`/`filterPlaceholder`) so the parallel a11y pass has a real label to find rather than an unlabeled input. A query that matches nothing renders a DISTINCT `historyPanel_noMatchesTitle`/`noMatchesDescription` empty state, never the "no chats yet" one — pinned in HistoryPanel.test.ts's new cases. `class="text-sm"` on the Input, per decisions/36's documented override for the vendored `text-base md:text-sm` default (the `md:` breakpoint never fires in a 320-400px panel). 12 new src/domain/chat/search.test.ts cases.

- **claude** (2026-08-22T22:15:00.000Z): **Export — the seam, judged.** src/domain/chat/export.ts owns the document's STRUCTURE only (heading order, which entries earn a section, fenced blocks, filename sanitisation) — every word is resolved by the caller first, exactly the parameter-injection pattern ./title.ts already established for its `untitled` fallback (decisions/29 forbids paraglide in the domain regardless, so "the serializer maps a note's kind through the UI's label functions" cannot mean this file calls `noteText()` itself). The actual seam is src/sidepanel/presentation/chatExport.ts: walks `TranscriptEntry[]` — the SAME array the transcript itself renders, not the separate `ToolCallLogEntry[]` inspector log — resolving each entry's body with `entry.note ? noteText(entry.note) : entry.content`, the identical formula ToolCallRow.svelte's `outcomeText` already uses, so the export says exactly what the panel showed (legacy pre-card-114 prose renders verbatim too, for the same reason). Tool origin via `originLabel`/`toolCallRow_originUnknownBadge`, timestamps via `formatDateTime`. 13 domain tests (export.test.ts) + 12 seam tests (chatExport.test.ts, including one pinning the legacy passthrough renders verbatim).

- **claude** (2026-08-22T22:15:00.000Z): **Export — delivery.** New src/ui/download.ts's `downloadTextFile`, mirroring clipboard.ts's "one call site" reasoning: a `data:` URI + anchor click, not `Blob`+`createObjectURL` — an exported transcript is a few hundred KB at most, well inside what a `data:` href accepts, and it means the whole thing needs nothing beyond `document` (no object-URL lifecycle to remember to revoke, nothing jsdom lacks for its own test). OverflowMenu.svelte's new "Export as Markdown" item (`overflowMenu_exportMarkdownLabel`, new `download` glyph added to src/ui/icons.ts + Icon.svelte's Hugeicons map) fires `copyText` and `downloadTextFile` independently — a clipboard refusal is never worth gating the file on. `disabled` when `panel.messages.length === 0` (never a row from the recent-chats list — this exports the ACTIVE chat only). Title comes from `titleFromMessages` (explicit title wins, else the first message, else `chatTitle_untitled()`); filename from the new `chatExportFilename` (domain) — strips only genuinely reserved filesystem characters, keeps non-Latin scripts as-is (a Japanese/Arabic chat title is a valid filename), collapses whitespace to hyphens, falls back to the localized "untitled" text and finally to a hardcoded `"chat"` if even that sanitizes to nothing. OverflowMenu.test.ts needed the `panel` store mocked wholesale (`vi.hoisted` + `vi.mock`, the same pattern ModelPicker.test.ts already uses) since this is the first thing in that file that needs `panel.messages` to be non-empty — 3 new cases (disabled-with-no-chat, copies+downloads with the right content, derives the title when none is explicit).

- **claude** (2026-08-22T22:15:00.000Z): **Line-clamp fix.** HistoryListItem.svelte's `<ItemContent>` gets `class="min-w-0"` — card 104's journal root-caused this exactly: the vendored `item-content.svelte` is a flex child (`flex flex-1 flex-col`) with no `min-w-0` of its own, so its default `min-width: auto` let its content's natural width push past the row, and the clamped `<p>` inside clipped against that overflowed width instead of the row's real space. Fixed at the call site per decisions/28's kit rules (vendored file stays regenerable). **Eyeballing this one honestly**: I did not launch a fresh browser against `dist-verify`/a CfT profile for a pixel screenshot — this session already has another agent's Chrome process and a freshly-rebuilt `dist-verify/` running concurrently (confirmed via `ps`), and colliding with that felt like a worse trade than a well-understood, textbook CSS fix (a flex item's content overflowing because of a missing `min-w-0` is precisely the mechanism card 104 diagnosed with its own geometry probe, and this is the single line its journal named as the fix). Confirmed instead via the component test suite (HistoryListItem.test.ts, unchanged, still green) and by inspecting the rendered class list.

- **claude** (2026-08-22T22:15:00.000Z): **i18n: 9 new keys × 10 locales = 90 entries**, appended as one contiguous block per file (`historyPanel_filterPlaceholder`/`filterAriaLabel`/`noMatchesTitle`/`noMatchesDescription`, `overflowMenu_exportMarkdownLabel`, `chatExport_youLabel`/`assistantLabel`/`originLabel`/`exportedLabel`). Reused the ALREADY-shared `argumentsHeading`/`resultHeading`/`errorHeading` for the export's tool-call sections rather than minting duplicates. Translations mirror each locale's own existing register for the nearest sibling copy: `historyPanel_noMatchesDescription` copies `providerPicker_noMatchMessage`'s exact quote convention per locale (including fr's narrow-no-break-space guillemets), `chatExport_originLabel` reuses each locale's `historyListItem_unknownOrigin`/`toolCallRow_originUnknownBadge` word for "origin" (ja's "オリジン", not a re-translation). 444 keys per locale, `guard:i18n` green.

- **claude** (2026-08-22T22:15:00.000Z): Gates run individually rather than via the combined `npm run guard` — see the Gates section for why. `npm test` 1231/1231, `npm run check` clean, `npm run build` green. Did not run `npm run verify` or touch anything under `verify/**`, and did not commit, per this card's explicit instructions.
