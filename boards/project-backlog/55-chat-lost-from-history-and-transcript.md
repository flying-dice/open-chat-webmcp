---
column: review
labels: [bug, frontend]
priority: high
agent: claude
updatedAt: 2026-08-20T12:50:00.000Z
---
# Chat lost from BOTH history and the transcript after leaving a tab

Reported by Jonathan after card 54 shipped: "this fix did not work, when I
exit and enter the tab the history does not have the chat and the chat is
reset to `No messages yet. Ask something about this page, or just say
hello.`"

Card 54's staleness guard fixed a real race, but it was the WRONG race — it
only prevents a stale `refreshActiveTab` from overwriting `pageInfo`/the live
session. It cannot explain a chat vanishing from the **history list**, which
reads `chat:index` and never touches the tab-activation path at all. Card 54
was written and shipped without ever reproducing the reported symptom; that
is the mistake to not repeat here.

Two distinct symptoms, and they need two explanations:

1. **Gone from history** — `listChatSummaries` reads only `chat:index`
   (`src/lib/session.ts:635-639`), so the chat's index entry is missing.
2. **Transcript reset to the empty state** — `getOrCreateChatForTab`
   (`src/lib/session.ts:473-485`) returned a fresh `createChat` instead of
   the tab's real chat, which means the `tabchat:<tabId>` pointer was
   missing/origin-mismatched, or `readChatRaw` returned `undefined`. Note
   `syncSessionToTab` (`src/sidepanel/stores/panel.svelte.ts:337-343`) then
   calls `setCurrentChatForTab` with that fresh chat's id, **overwriting the
   pointer and orphaning the real chat permanently**.

## Confirmed root cause for symptom 1 (lost-update on `chat:index`)

`commitSession` (`src/lib/session.ts:329-347`) does an unserialized
read-modify-write of `chat:index`:

```ts
await chrome.storage.local.set({ [key]: session });
const index = await readChatIndex();      // <-- await
const nextIndex = index.filter((e) => e.id !== session.id);
nextIndex.push({ ...entry });
await writeChatIndex(nextIndex);          // <-- clobbers a concurrent write
```

Two concurrent `commitSession` calls for DIFFERENT chats both read the index
before either writes, so the second write drops the first chat's entry. The
chat's own `chat:<id>` record survives — it is simply invisible to history
forever after.

A tab switch is exactly when two different chats commit at once:

- The outgoing tab's chat may have a debounced write flushing
  (`appendAssistantDelta` → `saveSession(session)`, `src/lib/session.ts:576-586`).
- The incoming tab's chat is committed immediately, because
  `ProviderPicker.svelte:80` calls `syncToTab` on every `pageInfo` change,
  which seeds the default selection via `setSessionSelection`
  (`selection.svelte.ts:286`) → `saveSession(session, {immediate: true})`
  (`panel.svelte.ts:501`).

Reproduced in isolation with a scratch harness mirroring `commitSession`
against an async fake storage: both `chat:` records were written, but
`chat:index` ended up containing only one of the two — the other chat was
silently unreachable from history. This is a textbook lost update and is
worth fixing regardless of what else is going on.

## RESOLVED — symptom 2's actual root cause: storage corrupts every persisted chat

Jonathan supplied a real `chrome.storage.local` dump (63 chat records). It
showed the actual mechanism, and it is NOT anything in `activeTab.ts`'s
origin/pointer logic:

- Every one of the 63 stored `chat:<id>` records had `messages: {}`-shaped
  (numeric-keyed object, not an array) and `toolCalls` likewise — e.g. chat
  `42703cd4-3c88-402c-8c84-a49276ec4cb3`'s `chat:index` entry says
  `messageCount: 12`, but its `chat:42703cd4...` record has zero messages,
  both written by the SAME `commitSession` call (identical `updatedAt`).
- `isChatSession` (`src/lib/session.ts:215-228`) requires
  `Array.isArray(v.messages)` and `Array.isArray(v.toolCalls)` — both fail
  for every stored chat, so `readChatRaw` returns `undefined` for all of
  them.

That single fact explains both symptoms completely:

- `getOrCreateChatForTab` (`src/lib/session.ts:473-485`) always falls
  through to `createChat` → the transcript resets to "No messages yet" on
  every tab switch (symptom 2).
- `getChat` likewise always returns `undefined` → `openChatInTab` always
  returns `false` → clicking a history entry does nothing (this is also why
  card 53's boolean-gated fix looked like it changed nothing: the gate is
  correct, the boolean is just always false).

**Mechanism, proven empirically in the real browser (not reasoned to):**
`session` in `src/sidepanel/stores/panel.svelte.ts:246` is
`$state<ChatSession | undefined>`, so the live chat object `commitSession`
receives is always a Svelte 5 reactive `Proxy`. Built a scratch harness that
bundles the actual installed `svelte` package's `proxy()` (the exact
function `$state` compiles to, `node_modules/svelte/src/internal/client/proxy.js`)
and ran it in a real built extension (Chrome for Testing) against the real
`chrome.storage.local`:

- `Array.isArray(chat.messages)` on the live proxy: `true` (correct,
  in-memory).
- After a real `chrome.storage.local.set()` / `.get()` round trip:
  `Array.isArray(roundTripped.messages)` → `false`; the value comes back as
  `{"0": {...}}`.

A companion Node test (same real `proxy()` import) showed `JSON.stringify`
on the identical proxy DOES correctly serialize it as `[...]` (spec-correct
`IsArray` unwrapping through the Proxy to its target), and `structuredClone`
can't even clone it at all (throws "could not be cloned" outright). So
`chrome.storage.local`'s own internal argument serializer is the thing that
mishandles the Proxy — `JSON.stringify`/`JSON.parse` does not.

## Fix

- `src/lib/session.ts`: added `toPlain()` (`JSON.parse(JSON.stringify(value))`)
  and call it in `commitSession` before `chrome.storage.local.set` — the
  single choke point every writer (`saveSession`'s immediate path, the
  debounced `flushSession` path, migration) already funnels through, so no
  writer can regress this by forgetting to snapshot first.
- Kept/implemented the `chat:index` lost-update serialization from symptom
  1's original diagnosis: a module-level `indexQueue` promise chain
  (`withIndexLock`) now serializes every read-modify-write of `chat:index` —
  `commitSession`'s index update + eviction (unified into one lock
  acquisition via `evictIfNeededLocked`, since the lock isn't reentrant),
  `deleteChat`, and `clearAllChats`.
- Explicitly did NOT add a coercion/repair-on-read path for the existing 62
  corrupted chats, or any purge/migration tooling — descoped by Jonathan
  (pre-release, no data worth preserving). `clearAllChats`
  (`src/lib/session.ts`, the options page's "Clear all history") already
  removes every `chat:*`/`tabchat:*` key and is the existing, zero-code way
  to clean up the corrupted records — pointed at that rather than writing
  new pruning code.
- Did NOT touch `syncSessionToTab`/`getOrCreateChatForTab`'s
  origin/pointer-orphan logic — the evidence showed that mechanism was never
  the cause; changing it would have been exactly the kind of unreproduced,
  speculative fix this card exists to avoid.

## Checklist

- [x] Reproduce the chat vanishing from history and/or the transcript in a
      real browser, with the failing state dumped from `chrome.storage.local`
      (`chat:index`, the `chat:<id>` records, and every `tabchat:<tabId>`) —
      done via Jonathan's real dump plus a real-browser proxy/storage
      round-trip test
- [x] Identify the actual mechanism behind the transcript reset (symptom 2)
      from that evidence — not from reasoning alone — the Proxy/storage
      corruption above
- [x] Serialize `commitSession`'s `chat:index` read-modify-write so
      concurrent commits can't lose an entry (symptom 1)
- [x] Fix the actual symptom-2 mechanism: strip the Svelte `$state` Proxy
      before it ever reaches `chrome.storage.local` (supersedes the
      originally-planned "never orphan a chat" pointer fix, which the
      evidence showed was not the cause)
- [x] Re-run the reproduction and show it now passes
- [x] `npm run check` and `npm run build` green
- [ ] ~~Repair/coerce existing corrupted chats on read~~ — explicitly
      descoped by Jonathan (pre-release, no data worth preserving); use
      "Clear all history" on the options page instead

## Comments

- **claude** (2026-08-20T10:58:14.000Z): Raised after Jonathan reported card
  54's fix did not resolve the symptom. Confirmed by reading the code that
  card 54's guard (`src/sidepanel/services/activeTab.ts`) could not have
  addressed a chat disappearing from the history list, since
  `listChatSummaries` (`src/lib/session.ts:635-639`) reads `chat:index` and
  is entirely independent of the tab-activation path — card 54 fixed a real
  but different race, and was shipped without a reproduction. Diagnosed and
  reproduced (in an isolated scratch harness mirroring `commitSession`,
  `src/lib/session.ts:329-347`) a lost-update on `chat:index`: two concurrent
  commits for different chats both read the index before either writes, so
  one chat's entry is dropped while its `chat:<id>` record survives —
  invisible to history forever. Confirmed the tab-switch concurrency that
  triggers it is real: `ProviderPicker.svelte:80` calls `syncToTab` on every
  `pageInfo` change, which writes immediately via `selection.svelte.ts:286`
  → `panel.svelte.ts:501`, while the outgoing chat may still be flushing a
  debounced write. Also noted a permanent-orphan hazard: when
  `getOrCreateChatForTab` (`src/lib/session.ts:473-485`) falls back to a
  fresh chat, `syncSessionToTab` (`src/sidepanel/stores/panel.svelte.ts:342`)
  immediately overwrites `tabchat:<tabId>` with the new id, so the real chat
  can never be recovered by that tab again. Ruled out a missing `tabs`
  permission (present in the built manifest, so `tab.url` is available).
  Deliberately NOT fixing symptom 2 yet — the transcript reset is not
  explained by the index race, and this card is explicitly reproduce-first
  so we stop shipping speculative fixes.
- **claude** (2026-08-20T12:50:00.000Z): Jonathan supplied a real
  `chrome.storage.local` dump (`storage-chat.json`, repo root) that
  overturned the symptom-2 hypothesis above. Every one of the 63 stored
  `chat:<id>` records has `messages`/`toolCalls` as a numeric-keyed object,
  not an array — e.g. chat `42703cd4-3c88-402c-8c84-a49276ec4cb3`'s
  `chat:index` entry says `messageCount: 12` while its `chat:42703cd4...`
  record has zero, both stamped with the identical `updatedAt`, proving one
  `commitSession` call wrote both. `isChatSession`
  (`src/lib/session.ts:215-228`) requires `Array.isArray` on both fields, so
  every stored chat fails validation — `getOrCreateChatForTab`
  (`src/lib/session.ts:473-485`) always falls back to a fresh chat
  (symptom 2) and `getChat`/`openChatInTab` always return
  `undefined`/`false` (why clicking history did nothing, including after
  card 53's fix). Proved the mechanism empirically, not by reasoning: built
  a scratch harness (esbuild-bundled, run inside a real built extension via
  `verify/lib/browser.mjs`'s `launchExtension()`) that imports the actual
  installed `svelte` package's `proxy()` — the function `$state` compiles to
  (`node_modules/svelte/src/internal/client/proxy.js`) — wraps a chat object
  with it exactly as `src/sidepanel/stores/panel.svelte.ts:246`'s
  `session = $state<ChatSession|undefined>` does, and round-trips it through
  the REAL `chrome.storage.local.set`/`.get`: `Array.isArray` on the live
  proxy's `messages` is `true`, but `false` after the storage round trip
  (comes back as `{"0": {...}}`) — reproducing Jonathan's dump exactly. A
  companion Node test with the same real `proxy()` showed `JSON.stringify`
  correctly serializes the identical proxy as `[...]` (spec-correct `IsArray`
  Proxy-unwrapping) while `structuredClone` can't clone it at all (throws) —
  so `chrome.storage.local`'s own internal argument serializer, not
  `JSON.stringify`, is what mishandles the Proxy. Fixed at the single choke
  point: added `toPlain()` (`JSON.parse(JSON.stringify(value))`) in
  `src/lib/session.ts`'s `commitSession`, applied before
  `chrome.storage.local.set`, so every writer (`saveSession`'s immediate
  path, debounced `flushSession`, migration) is covered without having to
  remember to snapshot individually. Also implemented the `chat:index`
  serialization from the original symptom-1 diagnosis:
  `withIndexLock`/`indexQueue` (`src/lib/session.ts`) now serializes
  `commitSession`'s index update (unified with eviction into
  `evictIfNeededLocked` to avoid a reentrant-lock deadlock), `deleteChat`,
  and `clearAllChats`. Verified end to end with a second real-browser
  harness that imports the REAL `src/lib/session.ts` (unmodified,
  esbuild-bundled standalone) plus the real `svelte` proxy: a chat mutated
  through a live `$state` proxy, saved via the real (fixed) `saveSession`,
  now resolves as the SAME chat (not a fresh fallback) through
  `getOrCreateChatForTab` after a simulated tab-switch-back, is found by
  `getChat` (history open), and shows the correct `messageCount` in
  `listChatSummaries` — confirmed this test FAILS on the pre-fix code
  (reverted via `git stash` and re-run) with exactly
  "tab switch back must resolve the SAME chat, not a fresh fallback", then
  confirmed it passes again after restoring the fix. Also verified 10 pairs
  (20 chats) committed concurrently via `Promise.all` all appear in
  `chat:index` — no lost updates. Descoped (per Jonathan): no
  coercion/repair path for the 62 already-corrupted chats and no purge
  tooling — pre-release, nothing worth preserving; `clearAllChats` (already
  wired to the options page's "Clear all history") is the existing way to
  clean those up. Did not promote either scratch harness into `verify/`:
  both bundle `src/lib/session.ts`/the raw `svelte` proxy standalone via
  esbuild rather than exercising the real shipped `dist/` bundle the way
  `verify/run.mjs`'s existing checks do (real UI/`chrome.runtime` messages
  against the built extension), so folding them in as-is would be a
  different kind of check than that suite's convention; a real end-to-end
  chat-persistence check there would need a way to drive the composer's
  send flow without a live LLM (e.g. a local fake provider server), which is
  a larger follow-up, not part of this card. `npm run check` (0 errors) and
  `npm run build` both green.
