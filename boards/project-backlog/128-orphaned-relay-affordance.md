---
column: todo
labels: [frontend, bug]
priority: med
updatedAt: 2026-08-23T23:50:00.000Z
---
# Surface the orphaned-relay state after an extension reload

After an extension update/reload, every already-open tab keeps an orphaned
content script: the panel's pulls and tool listing fail with
receiving-end-does-not-exist until the PAGE is reloaded — and a focus-pull
failure is silent by design, so the product reads as broken (lived
experience 2026-08-23: "still no chip"). Options, judge and journal:
(a) detect the unreachable-but-not-restricted state and show a localized
"Reload the page to reconnect" hint on the context chip; (b) re-inject the
relay into open tabs on onInstalled via the scripting permission — which
card 86 REMOVED as dead, so re-adding needs decision-40-level care and a
listing-justification update; (c) both. Ship at least the hint.

## Checklist

- [ ] Chosen approach implemented; hint localized x10 if (a)
- [ ] Chaos/component test for the unreachable-after-reload state
- [ ] Store-listing permission table updated if scripting returns
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green
