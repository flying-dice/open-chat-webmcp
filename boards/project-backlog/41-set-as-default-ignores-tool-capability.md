---
column: todo
labels: [frontend, bug]
priority: med
updatedAt: 2026-08-20T14:20:00.000Z
---
# "Set as default" bypasses the tool-capability check

Flagged by card 35 while implementing forced model selection, from
`src/sidepanel/**` — the fix belongs in `src/options/**`, so it was reported
rather than reached for.

The side panel's picker is careful about capability: models reporting `no-tools`
or `unknown` are shown disabled with an inline reason, per
decisions/11-provider-capability-detection.md, so a user cannot pick something
that silently ignores every page tool.

The options page's "Set as default" applies no such check. A default set there can
name a model with no tool-calling support, which then seeds new chats. Card 35
makes that seeded value non-explicit so the user is asked to confirm before their
first message — which contains the damage — but the underlying setting is still
one the picker itself would refuse to let them make.

Two surfaces disagreeing about what is a valid selection is the same class of
inconsistency as the 403 (card 33): each is defensible alone, together they are
confusing.

Fix: apply the same three-state capability rule at the point the default is set.
A `no-tools` model should not be settable as a default; `unknown` should follow
whatever decision 11 says the picker does, so the two behave identically.

## Checklist

- [ ] Capability checked when setting a default, matching the panel picker exactly
- [ ] `no-tools` refused with the same inline reason wording the picker uses
- [ ] `unknown` handled the same way the picker handles it
- [ ] An existing stored default that is now invalid surfaces clearly rather than silently
