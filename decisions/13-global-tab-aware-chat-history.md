---
status: Accepted
date: 2026-08-20
---
# Decision 13 — Chat history is a global, tab-aware list

## Context

Decision 07 made a chat session an artefact OF a tab: keyed by tab id, discarded
when the origin changed, capped at 20 and evicted oldest-first. That was right for
an assistant that only ever acted on the page in front of you, and it is what is
built today.

The product now needs a history panel — open the panel, see previous chats, pick
one up. Under the current model most of those conversations do not survive long
enough to be listed: a cross-origin navigation resets the session, a recycled tab
id discards it, and eviction silently drops the oldest. A history panel over that
storage would show a list with holes in it.

## Decision

A chat becomes a first-class object with its own identity, not a property of a tab.

- Chats are stored under their own id and listed globally, newest first, across
  every site.
- Each chat still RECORDS the origin it was started against, and the history list
  shows it. The tab binding becomes a soft association rather than the identity.
- Opening a chat in a tab whose origin differs from the chat's own is allowed. The
  transcript stays readable, but the panel states plainly that this page's tools
  are not the ones the conversation used, and page tools attach from the CURRENT
  tab only.
- A tab still has a *current* chat, so switching tabs still shows what you were
  doing on that tab. That is now a pointer from tab to chat id, not ownership.
- Cross-origin navigation no longer destroys a conversation. It ends the chat's
  association with that tab and starts a new current chat, leaving the old one in
  history.
- Eviction by count is replaced with explicit deletion plus a much higher cap. A
  history feature whose entries vanish on their own is worse than no history.

This REVISES decisions/07-session-state-and-persistence.md on session identity,
cross-origin reset, and eviction. The rest of 07 stands unchanged: storage is
still `chrome.storage.local`, writes are still debounced, history is still
unencrypted and may contain authenticated page content, and the single-owner
invariant for the in-memory session object (see card 29) still holds.

## Consequences

- Storage grows with use in a way the old cap prevented. Deletion becomes a
  first-class user action rather than a background behaviour, and the options page
  needs to show what is stored.
- Migration: sessions already on disk are keyed by tab id. They need either
  converting to the new id scheme or discarding on upgrade. Discarding is
  defensible this early, but it must be a deliberate choice, not an accident that
  silently drops a user's conversations.
- The panel must handle a chat whose provider or model no longer exists, which the
  existing dangling-provider handling already covers.
- Tool availability and conversation history are now decoupled, which is the point
  — but it means the transcript can contain tool calls the current page cannot
  make. The UI must not imply those are re-runnable.
