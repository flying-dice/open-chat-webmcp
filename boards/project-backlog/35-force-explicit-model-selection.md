---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-20T10:30:00.000Z
---
# Force an explicit model selection before chatting

"As a user on the chat window I should be forced to select the model."

Today a selection can resolve implicitly from a stored default, so it is possible
to start typing without ever having consciously chosen what will answer — and,
worse, without noticing that the resolved model cannot call tools
(decisions/11-provider-capability-detection.md).

Require a deliberate choice before the first message of a chat. Remembering that
choice for subsequent chats is fine; silently inheriting one that was never made
is not.

Blocking the composer is the mechanism, so the empty state has to do real work:
say what is needed and route to the picker in one click. A disabled input with no
explanation is a worse experience than the implicit default it replaces.

## Checklist

- [ ] Composer disabled until a provider + model is explicitly selected
- [ ] Clear inline prompt that routes to the picker, not a bare disabled box
- [ ] A remembered previous choice counts as explicit; an unconfirmed default does not
- [ ] Interaction with a dangling provider (card 23) — treat as unselected
- [ ] Does not fight the no-providers-registered empty state from card 14
