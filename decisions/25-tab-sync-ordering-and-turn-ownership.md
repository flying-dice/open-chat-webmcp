---
status: Accepted
date: 2026-08-20
---
# Decision 25 — The transcript never waits on the worker, and a turn belongs to a chat

## Context

Cards 54 and 55 both chased "my chat is gone after switching tabs", and both
fixed real bugs — a stale-result race in `src/sidepanel/services/activeTab.ts`,
and a Svelte `$state` Proxy being mangled by `chrome.storage.local`'s serializer
in `src/lib/session.ts`. Neither made the symptom go away.

A fresh `chrome.storage.local` dump taken after card 55's `toPlain` fix settled
what is left. Storage is **healthy**: the reported chat holds all 8 of its
messages and both tool-call log entries, `everyMessageValid` is true, its
`tabchat:<tabId>` pointer resolves to it with a matching `tabOrigin`, the live
tab is at that same origin, and every diagnostic bucket the dump script checks
(`orphanedChats`, `indexWithoutRecord`, `danglingPointers`, `originMismatches`,
`chatsFailingValidation`) is empty.

So `getOrCreateChatForTab` would return the right chat if it were called. The
panel was showing an empty chat belonging to the *other* tab — the one switched
away from — while the real conversation sat intact on disk and in the History
list. The bug is not in persistence at all. It is in the side panel's live-state
sync, and it has two independent halves.

**Half one — the session swap is gated behind a service-worker round-trip.**
`refreshActiveTab` (`src/sidepanel/services/activeTab.ts`) awaits
`getToolsAndAvailabilityForTab` — a `chrome.runtime.sendMessage` to the MV3
background worker — *before* it calls `syncSessionToTab`. Restoring a transcript
has no dependency whatsoever on tool information. MV3 terminates an idle worker
after roughly 30 seconds, which is precisely its state when the user returns to
a tab they left. The existing `try/catch` there covers a rejection but not the
case that actually bites: a `sendMessage` to a worker that is cold-starting, or
that is torn down mid-message, can leave the promise unsettled, and there is no
timeout. When that happens the swap never runs.

**Half two — a turn is bound to whatever session is visible.** `runAgentTurn`
(`src/sidepanel/services/agentLoop.ts`) never records which chat it started on.
Every panel mutator writes to the module-level `session` variable as it stands
at the moment of the call. Switch tabs mid-generation and
`appendAssistantDelta`/`endAssistantMessage` look their message up in the *new*
session, fail to find it, and silently drop the reply; `addToolCall` does not
look anything up at all and pushes the tool message and its call-log entry into
the incoming tab's chat; and the next provider request is rebuilt from
`panel.messages`, i.e. the wrong conversation. Jonathan's expectation — stated
directly — is that generation continues when he tabs away.

## Decision

### 1. The transcript restores before, and independently of, tool information

`refreshActiveTab` resolves and applies the session as soon as it has the tab's
URL, before any worker round-trip. `pageInfo`/`tools` continue to be applied
afterwards, behind card 54's existing `isStillActive` guard. The tools lookup is
additionally time-bounded, degrading to its already-defined
`{tools: [], available: true, restricted: false}` default rather than hanging.

The principle: **page identity and tool capability are enrichment; the
conversation is not.** Nothing about restoring what the user was reading may
depend on the availability of the background worker.

### 2. Tab-sync work is serialized, and navigation decisions are session-sourced

All `refreshActiveTab` calls funnel through a single promise chain, reusing the
`indexQueue`/`withIndexLock` shape already in `src/lib/session.ts`. Card 54's
`isStillActive` guard is an identity check, so it structurally cannot separate an
`onActivated` and an `onUpdated` for the *same* tab; serialization can.

`applyPanelNavigation` becomes tab-scoped — it takes the `tabId` it is acting for
and refuses to act when the panel is pointed elsewhere — and "did this tab
navigate?" is answered from `panel`'s own `activeTabOrigin`, never from
`pageInfo.origin`, which is display state that lags the swap.

A tab pointer is only written when it did not already resolve. A pointer that
resolved is correct by construction, and rewriting it is the mechanism by which a
spurious fresh chat orphans a real one permanently.

### 3. A turn belongs to a chat, not to the visible tab

`runAgentTurn` captures its `ChatSession` once, at the top, and every mutator it
drives targets that captured session explicitly. The provider conversation is
rebuilt from the captured session too, not from `panel.messages`.

`panel.svelte.ts` keeps a registry of live sessions by chat id, so that switching
back to a chat mid-generation re-attaches to the *same* in-memory object and the
reply is still streaming on screen — rather than reading a half-written snapshot
back from storage. `streamingMessageId` becomes per-chat for the same reason.

## Consequences

- Coming back to a tab shows that tab's conversation at `chrome.tabs.get` speed.
  A dead or slow worker can now only cost the tool count and the context chip.
- Tabbing away mid-answer no longer discards the answer. It lands in the chat it
  belongs to, and it is there when you come back.
- Tool calls can never be misfiled into the chat you happened to switch to.
- Generation still dies if the panel document itself is closed — the turn lives
  in the panel's JS context and there is no worker-side agent loop. That is a
  real limit and should be stated in the UI rather than papered over. Moving the
  loop into the background worker is a much larger change and is explicitly not
  decided here.
- The mutators gain an explicit target parameter, defaulting to the live session,
  so existing call sites are unchanged. `panel.svelte.ts`'s "single owner" note
  still holds: the store still owns every `ChatSession`, it just now owns more
  than one at a time.
- Approving a tool call in a chat that is not on screen is an open question. For
  now the approval UI remains tied to the visible chat, which means a background
  turn that needs approval will wait; card 58 is to surface that honestly rather
  than let it hang invisibly.

Supersedes nothing. Builds on decision 07 (per-tab session), decision 13 (global
tab-aware chat history), and cards 54/55, both of whose fixes stand.
