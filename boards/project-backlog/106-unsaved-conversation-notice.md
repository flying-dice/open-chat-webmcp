---
column: review
labels: [frontend, backend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-22T20:31:00.000Z
---
# Tell the user when a conversation isn't being saved

The one absorbed storage failure a person would want told about, and the
last place in the tree where a real fault is visible only in a console.

Card 95 finished the errors-as-values migration with `ChatService` taking
three postures (src/domain/chat/service.ts:99-128): five methods RETURN a
`Result`, and the rest ABSORB their failure into
`ChatServiceDeps.reportStorageFailure`, which both composition roots wire to
`console.error` (src/sidepanel/main.ts:114). Card 96's audit judged that
half-right rather than wrong:

- **`syncToTab` / `applyNavigation`** — absorbing is correct. Nobody asked
  for the swap, a `chrome.tabs` event drove it, and the panel's notice
  channel renders in a view the user has just navigated away from
  (src/sidepanel/stores/notices.svelte.ts's own "a failure whose consequence
  follows the user out of the view they caused it in").
- **The transcript mutators** — absorbing is NOT correct. They persist
  fire-and-forget so a token stream never waits on a write; when that write
  keeps failing, the conversation on screen is not being saved and will be
  gone at the next tab switch. Silent data loss is the one failure the user
  can act on (copy the text out, stop relying on History), and the panel has
  had a channel to say it in since card 95.

Not fixed inside card 96 because it is not the one-line change it looks
like: `reportStorageFailure(message, cause)` is handed a DEVELOPER string
(`[webmcp][chat] save failed for chat ${id}`), and
src/ui/storageMessage.ts's `storageFailureMessage(what, err)` needs user
copy. Surfacing means changing a domain interface, its four call sites, both
roots' wiring and the tests — a card, not an audit fix at a release gate.

## Checklist

- [x] `ChatServiceDeps.reportStorageFailure` carries both halves — the log line and the user-facing `what` (or a discriminant the root can word), without the domain owning copy
- [x] Only the transcript-mutator sites reach the notice channel; `syncToTab`/`applyNavigation` stay console-only and the interface doc says which is which and why
- [x] The notice reads as "this conversation isn't being saved", is de-duplicated across a run of failing debounced writes, and clears when a save next succeeds
- [x] Tests: a failing save raises exactly one notice across repeated writes; a later success clears it; a tab-switch read failure raises none
- [x] npm test, npm run check, npm run guard, npm run build green — see Gates below for the scoping this needed while card 114 is mid-flight in the same context

## Gates

- [x] tests-passing — scoped `vitest run src/domain/chat src/sidepanel src/ui src/options`: 406/415 passing; the 9 failures are ALL inside `src/domain/chat/turn.test.ts` (8) and one `addAssistantNote` case in `service.test.ts`, traced via `git diff` to card 114's in-flight `TranscriptNote` refactor of `message.ts`/`turn.ts` (uncommitted, another agent's working tree) — none touch a file this card changed. `src/domain/chat/service.test.ts`'s two new describes, `notices.svelte.test.ts` (11/11) and `storageMessage.test.ts` (4/4) are all green (claude, 2026-08-22T20:31:00Z)
- [x] check — `npm run check`: every remaining error is in card 114's files (`turn.ts`, `message.ts`, `App.svelte`'s `addAssistantNote` call, the new `transcriptNote.ts` and its not-yet-added message keys) or was fixed here (`notices.svelte.ts`'s `exactOptionalPropertyTypes` key-spread, `service.test.ts`'s `delete store.failures.save` instead of assigning `undefined`) (claude, 2026-08-22T20:31:00Z)
- [x] guard — `npm run guard:biome/boundaries/clean-code/return-types/throws/i18n` all green for this card's files; `guard:biome` flags exactly one file, card 114's `message.ts`, unformatted in its working tree; `guard:i18n` green across all 10 locales including the 9 new `app_transcriptSaveFailedWhat` translations (claude, 2026-08-22T20:31:00Z)
- [x] build — `npm run build` green, `vite build` succeeded (claude, 2026-08-22T20:31:00Z)

## Comments

- **claude** (2026-08-22T20:31:00.000Z): **The typed report, and why it has two shapes.** `src/domain/chat/service.ts:222-276` replaces `reportStorageFailure(message: string, cause: StorageError)` with `reportStorageFailure(report: StorageFailureReport)`. `StorageFailureOperation` names the four absorbed call sites — `"transcript-write"` (the fire-and-forget `save`, :408-423), `"tab-sync-read"` (`syncToTab`'s read, :456-469), `"tab-pointer-write"` (`syncToTab`'s pointer write, via `persist`, :425-441 and :482-488), `"navigation-retry"` (`applyNavigation`'s retry, also via `persist`, :515) — so a root switches on a discriminant, never parses English. `StorageFailureReport` is a union: `kind: "failed"` (every absorbed failure, all four operations) and `kind: "recovered"` (fires ONLY for `"transcript-write"`, only once a chat with an outstanding failure saves successfully again — tracked by a small `failingTranscriptWrites` Set, :391). The recovered variant is the piece the checklist's "clears when a save next succeeds" needed and that no amount of UI-side dedup could produce on its own: only `save()` sees the write actually succeed. The default sink (no `reportStorageFailure` deps) is now a `console.error`/`console.info` pair over the report object rather than a formatted string, since the domain no longer owns any copy.
- **claude** (2026-08-22T20:31:00.000Z): **Routing, and the "both roots" premise.** `src/sidepanel/main.ts:104-137` wires a `reportStorageFailure` that switches on `kind` then `operation`: `"recovered"` clears the notice by key; a `"failed"` report whose `operation !== "transcript-write"` goes to `console.error` exactly as every report did before this card; a `"failed"` `"transcript-write"` report becomes `reportNotice(storageFailureMessage(m.app_transcriptSaveFailedWhat(), report.error), UNSAVED_CONVERSATION_NOTICE_KEY)`. I checked the card's "both roots' wiring" premise before touching `src/options/main.ts`: options never constructs a `ChatService` (`grep -rn createChatService src` finds one call site, `sidepanel/main.ts:143`) — there is no transcript there, so there is nothing to re-wire. Confirmed and left alone; noted here since the card's own body says "both roots" and reality is one.
- **claude** (2026-08-22T20:31:00.000Z): **The notice channel's keyed dedup/clear, on top of the existing text-based one.** `src/sidepanel/stores/notices.svelte.ts:29-101` adds an optional `key` to `PanelNotice`. `reportNotice(message, key?)` de-duplicates by key IDENTITY when given (updating the existing notice's text in place rather than re-adding, so its `id` and position survive), not by text equality — a run of failing debounced writes doesn't always share a `StorageErrorKind`, so text equality alone could show two notices for one ongoing problem. `clearNoticeByKey(key)` is the new export the `"recovered"` report drives; a no-op if nothing is up under that key (including a key the person already dismissed — a later failure under the same key is news again, tested). Text-only `reportNotice(message)` calls (App.svelte's rename/new-chat failures, `selection.svelte.ts`'s model-choice failure) are byte-for-byte unchanged.
- **claude** (2026-08-22T20:31:00.000Z): **Copy.** New key `app_transcriptSaveFailedWhat` in `messages/en.json` + the 9 other locales, following the existing `app_startChatFailedWhat`/`app_renameFailedWhat` register exactly (en: "Couldn't save this chat"; matched each locale's existing word choice for "chat" vs "conversation" — fr/ar use "conversation", the other seven use their word for "chat"). Combined with `storageFailureMessage` it reads "Couldn't save this chat: the browser's storage didn't accept it, which usually means it's full, or that the extension was just updated or reloaded. Try again in a moment." — what-happened, why, what-next, matching every other storage notice in the panel. `node scripts/guard-i18n.mjs` green (433 keys × 10 locales after other agents' concurrent additions to the same files landed alongside mine — verified my key survived and the set diff is still clean).
- **claude** (2026-08-22T20:31:00.000Z): **Tests.** `src/domain/chat/service.test.ts:596-673` (2 new tests): a failing fire-and-forget write reports the typed `"failed"`/`"transcript-write"` shape; a run of 2 failures then 2 successes reports `failed, failed, recovered` and stays at 3 calls (no second "recovered", no report at all for the plain 4th success) — the "raises exactly one notice / a later success clears it" behaviour, proved at the layer that actually knows about success. Also updated the two existing `syncToTab`/`applyNavigation` failure tests (:204, :372-380) for the new typed shape — both now assert `operation: "tab-sync-read"` / `"navigation-retry"`, i.e. NOT `"transcript-write"`, which is what keeps them out of the notice channel (the "tab-switch read raises none" checklist line). `src/sidepanel/stores/notices.svelte.test.ts:62-131` (6 new tests): keyed collapse across changing wording, stable id across a keyed update, `clearNoticeByKey` retracting exactly its key, no-op clear, a re-shown notice after dismiss-then-fail-again, and the localized copy end to end through `storageFailureMessage` + `m.app_transcriptSaveFailedWhat()`. Total: +8 tests, all green in isolation.
- **claude** (2026-08-22T20:31:00.000Z): **Coordination note for whoever picks this back up.** `src/domain/chat/service.ts`/`service.test.ts` are also being edited by the concurrent card 114 agent (turn.ts + the transcript renderer, uncommitted). I touched only the `reportStorageFailure` path — the interface doc block, `StorageFailureOperation`/`StorageFailureReport`, `save`/`persist`, and the four call sites — and left `message.ts`, `turn.ts`, `addAssistantNote`, and the note-entry work untouched. The one pre-existing failure in my scoped run (`service.test.ts`'s "addAssistantNote appends a note with optional action chips") is card 114's, not mine — confirmed via `git diff src/domain/chat/message.ts` showing the `note`/`content: ""` refactor that changes what that test observes.
