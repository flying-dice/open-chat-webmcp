---
status: Accepted
date: 2026-08-19
---
# Decision 07 — Chat sessions are scoped per tab and persisted

## Context

The side panel is destroyed whenever it is closed, and a single panel instance is
shared across tab switches. Without a state model, switching tabs would bleed one
site's conversation into another, and closing the panel would lose the thread.

Tool availability is inherently per-tab: tools belong to the page in that tab and
change on every navigation.

## Decision

State is keyed by **tab id**, with the origin recorded alongside it:

- The service worker holds the authoritative per-tab **tool registry**, updated
  from the relay and cleared on navigation (`chrome.tabs.onUpdated`) and tab
  close (`chrome.tabs.onRemoved`).
- The panel holds one **session per tab**: message history, the selected model,
  and the tool-call log. Sessions are written to `chrome.storage.local` (debounced)
  and rehydrated when the panel opens or the active tab changes.
- Switching tabs swaps the visible session; it never merges histories.
- Navigating a tab to a **different origin** starts a fresh session — the old
  conversation refers to tools and page state that no longer exist. Same-origin
  navigation keeps the session and just refreshes the tool list.

The tool-call log (name, arguments, result or error, timing, whether it was
auto-run or approved) is part of the session and is what the inspector renders.

## Consequences

- Closing and reopening the panel resumes the conversation for that tab.
- Two tabs on two WebMCP sites keep two independent chats, which is the natural
  mental model for a per-page assistant.
- Storage grows with use, so sessions need an eviction policy — cap retained
  sessions and drop the oldest — plus a visible "clear history" control.
- Message history may contain page content and tool results from authenticated
  sites. It is stored unencrypted in `chrome.storage.local`, so this must be
  stated plainly in the README.
- Tab ids are recycled by Chrome after a tab closes; storing the origin next to
  the session lets a stale session be detected and discarded.
