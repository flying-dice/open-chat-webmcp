---
column: todo
labels: [frontend]
priority: high
updatedAt: 2026-08-20T10:30:00.000Z
---
# Chat history panel

"As a user on the chat window I should be able to open the history panel and
select previous chats."

Implements decisions/13-global-tab-aware-chat-history.md, which revises the
per-tab session identity in decisions/07-session-state-and-persistence.md. This is
the storage change; card 36 (new chat) depends on it, and should not ship first —
a New Chat button without history is a delete button.

Chats get their own id and are listed globally, newest first, each labelled with
the origin it was started against. A tab points at its current chat rather than
owning it. Cross-origin navigation no longer destroys a conversation; it starts a
new current chat and leaves the old one in history.

Opening a chat against a different origin must be allowed but honest: the
transcript stays readable, page tools come from the CURRENT tab, and the UI must
not imply old tool calls can be re-run here.

Migration matters: sessions already on disk are keyed by tab id. Converting or
discarding them is a deliberate call to make and state, not something to let
happen by accident.

## Checklist

- [ ] Chats keyed by their own id; tab holds a pointer to its current chat
- [ ] Global history list, newest first, with origin and a title/preview per entry
- [ ] Open a past chat; handle opening one whose origin differs from the tab
- [ ] Cross-origin navigation retires the chat to history instead of wiping it
- [ ] Replace count-eviction with explicit delete plus a high cap
- [ ] Migrate or deliberately discard existing tab-keyed sessions on upgrade
- [ ] Delete a chat, and clear-all, wired to the options history section
- [ ] Preserve the single-owner in-memory session invariant (card 29)
