---
column: todo
labels: [backend, frontend]
priority: med
updatedAt: 2026-08-24T11:00:00.000Z
---
# Persisted transcripts store codes, not prose

Implement decisions/38-transcript-stores-codes-not-prose.md: the turn
engine (src/domain/chat/turn.ts, sign-in adjacent notes, tool-call status
texts) stops composing English prose into persisted TranscriptEntry
values. Notes carry a kind + params (error code, tool name, affordances);
the transcript renderer maps them through messages at display time via a
shared UI module (the established *Message.ts pattern). Pre-release: no
migration — the write path changes; stored prose notes render via a legacy
passthrough branch or are left to eviction. Update the typed fixtures and
any screenshot seeds; the chaos/turn suites assert kinds instead of
sentences.

## Checklist

- [ ] TranscriptEntry note shape carries kind+params; turn.ts composes zero prose; guard's domain-purity + the paraglide-is-not-for-the-domain rule stay green
- [ ] Renderer maps kinds through messages; all ten locales render turn notes natively (spot-check ar + one CJK via the locale screenshot script)
- [ ] Fixtures/seeds updated; turn + chaos suites assert kinds
- [ ] Legacy prose passthrough branch present and tested (or explicit discard journalled)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green
