---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-20T10:30:00.000Z
---
# Start a new chat

"As a user on the chat window I should be able to start a new chat."

DEPENDS ON card 34. Until chats are retained in history, a New Chat button is a
destructive action wearing a friendly label — the previous conversation would be
gone with no way back.

Once history exists this is small: retire the current chat to history, create a
fresh one bound to the current tab, keep the model selection (a user who just
picked a model does not want to pick it again), and put focus in the composer.

## Checklist

- [ ] New Chat control in the panel header
- [ ] Retires the current chat to history rather than deleting it
- [ ] Carries the provider/model selection over to the new chat
- [ ] Focus lands in the composer, ready to type
- [ ] Sensible behaviour when the current chat is already empty (no empty duplicates)
