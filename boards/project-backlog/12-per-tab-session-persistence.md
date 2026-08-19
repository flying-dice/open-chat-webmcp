---
column: review
labels: [frontend]
priority: med
agent: claude
updatedAt: 2026-08-19T16:45:00.000Z
---
# Per-tab session persistence

One conversation per tab, surviving panel close and tab switching, per
decisions/07-session-state-and-persistence.md.

Cross-origin navigation starts a fresh session — the old thread refers to tools
and page state that no longer exist. Same-origin navigation keeps it and just
refreshes the tool list.

## Checklist

- [x] Session model: tab id + origin, messages, selected provider id + model, call log
- [x] Debounced writes to `chrome.storage.local`, rehydrate on panel open
- [x] Swap sessions on tab switch without merging histories
- [x] Reset on cross-origin navigation, keep on same-origin
- [x] Eviction: cap retained sessions, drop oldest
- [x] Clear-history control, and a clear-all in options
- [x] Discard sessions whose stored origin no longer matches the tab

## Comments

- **claude** (2026-08-19T16:45:00.000Z): Implemented `src/lib/session.ts` as a pure, UI-free storage module — the side panel builds on top of it. `ChatSession` (session.ts:70-80) holds `tabId`, `origin`, `messages: ChatMessage[]` (reused from `src/lib/provider.ts`), `selection?: ProviderSelection` (reused from `src/lib/providers/registry.ts`), and `toolCalls: ToolCallLogEntry[]` (session.ts:58-67, tracking name/arguments/result-or-error/timing/`mode: "auto"|"approved"|"denied"`). Storage: `chrome.storage.local` under `session:<tabId>` plus a `session:index` of `{tabId, updatedAt}` used for eviction and cheap listing (session.ts:103-107). `loadSession` (session.ts:260-278) discards and removes any stored session whose `origin` doesn't match the tab's current origin — the recycled-tab-id guard — verified in the scratch harness (`origin mismatch: recycled tab id is discarded, not resumed`). `applyNavigation`/`resetSession` (session.ts:295-330) implement the same-origin-keeps / cross-origin-resets rule, preserving `tabId` and (by default) `selection` across a reset since that's a user preference, not page state. `saveSession` (session.ts:389-415) debounces writes 400ms after the last change with a 2000ms max-wait fallback (`flushSession`/`flushAllSessions`, session.ts:418-428) so a continuous token stream still lands periodically and the panel can force a commit on unload. Eviction caps retained sessions at `MAX_RETAINED_SESSIONS = 20` (session.ts:103), dropping oldest-by-`updatedAt` in `evictIfNeeded` (session.ts:199-210). `clearSession`/`clearAllSessions`/`listSessionSummaries` cover per-session and clear-all history (options page can build its list from summaries without pulling full message bodies). Dangling providers are surfaced via `resolveSessionSelection` (session.ts:473-478), a thin wrapper over the registry's existing `resolveSelection` — no reimplementation of the tri-state ok/dangling/none logic. Verified with a scratch harness at `/private/tmp/claude-501/-Users-jonathanturnock-Projects-ollama-webmcp-chrome/a56e867f-1fd2-4a9e-9bef-d1a1e2866feb/scratchpad/session-harness.mjs` (12 cases: origin round-trip, origin-mismatch discard, tab-switch non-merge, cross-origin reset/same-origin keep, tool-call log states, debounce coalescing, trailing-edge fire, max-wait fallback under continuous activity, eviction over cap, clear-session, clear-all, flush-all) — all pass. `npm run check` (0 errors) and `npm run build` both green.
