---
status: Accepted
date: 2026-08-20
---
# Decision 24 — Chats get an optional explicit title

## Context

Chat titles today are a pure derivation. `src/sidepanel/lib/chatTitle.ts`
says so in its own doc comment: "Chats have no stored title" — the header
takes the first user message via `titleFromMessages`, and the history list
and overflow menu take `ChatSummary.preview` via `titleFromSummary`. That was
a deliberate, good call at the time: no schema change, no migration, no extra
provider round-trip, and the header and the menu can never disagree.

It stops being enough once you keep more than a handful of chats. A first
message is what you happened to open with, not what the conversation turned
out to be about, and several chats started with "hello" are indistinguishable
in a list. Jonathan asked to be able to rename a chat.

Decision 13 already established that a chat is a first-class entity with its
own identity, listed globally — a name is the missing piece of that identity.

## Decision

A `ChatSession` gains an **optional** `title`.

1. **Absent means derived.** When `title` is unset, every existing derivation
   stands exactly as it is now. This is not a migration: every stored chat is
   simply untitled, and nothing about it needs to change.
2. **An explicit title always wins**, in all three places a chat is named —
   the header, the overflow menu's recent list, and the History rows — so the
   "same chat is called the same thing everywhere" property that
   `chatTitle.ts` was built to guarantee is preserved.
3. **The title is duplicated into `chat:index`.** `listChatSummaries` reads
   only the index and never loads a chat's full record (that is the whole
   point of the index), so a title that lived only on the `ChatSession` would
   be invisible to the History view. This is the one real schema consequence,
   and it is the same denormalisation the index already does for `preview`
   and the counts.
4. **Clearing the title reverts to the derived one.** Saving an empty or
   whitespace-only name unsets the field rather than storing an empty string.
   That is the reset affordance; no separate "reset name" control is needed.
5. **Renaming does not reorder history.** History is ordered by `updatedAt`,
   which means *conversation* recency. Renaming is not conversation activity,
   and having a chat jump to the top of the list because it was relabelled is
   surprising. `saveSession` therefore needs a way to persist without
   stamping `updatedAt`.

The rename affordance is **inline editing of the header title** (chosen over
a per-row button in History and a kebab menu row). At 320px the header has no
room for another icon button, and this adds none — the title itself becomes
the control, and you rename the chat you are looking at. The trade-off
accepted: renaming an older chat means opening it first.

## Consequences

- `ChatSession`, `ChatIndexEntry`, and `ChatSummary` each gain `title?:
  string`, and both `isChatSession` and `isChatIndexEntry` must accept-or-
  reject it defensively the way they already do for `selection`/`preview`.
- `chatTitle.ts`'s two functions take the explicit title into account; its
  module doc comment's "chats have no stored title" premise is now wrong and
  must be rewritten rather than left to mislead.
- `Header.svelte` becomes interactive. It is shared by all three views and is
  handed the *view's* name ("Chat history", "Tools & call log") when not in
  chat, so editing must be explicitly opt-in per render, never inferred from
  the presence of a title string.
- Storage stays a plain key-value store; this is a field, not a new keyspace.
  It does not revisit decision 13's shape, and per the project's pre-release
  status no migration or back-compat path is written.
