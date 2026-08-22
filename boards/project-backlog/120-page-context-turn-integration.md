---
column: todo
labels: [backend, frontend, docs]
priority: high
updatedAt: 2026-08-24T12:30:00.000Z
---
# Page context: turn integration, fencing and the privacy story

Final card of decisions/40: the turn engine consumes PageContext — fenced
as untrusted exactly like tool results (decision 17's mechanism), with the
extract's truncation stated to the model, and sensible prompt placement so
selection outranks full-page text. Chaos tests: huge extract at the cap,
empty selection attached, page navigated between chip and send (stale
context policy: journalled decision — drop with a notice beats sending
stale), fencing proven against injection-shaped page text. Verify scenario:
select text on the demo page → chip appears → send with a live model (best
effort, liveSmoke pattern) or assert the fenced prompt at the ModelGateway
fake otherwise. docs/03-privacy-and-trust.md rewritten per decision 40
(only-what-you-visibly-share) and README's capability description updated.

## Checklist

- [ ] Turn assembly with fenced context; placement + truncation note tested at the gateway seam
- [ ] Chaos cases incl. stale-context policy and injection fencing
- [ ] Verify scenario landed (live where a model is reachable, gateway-seam assert otherwise)
- [ ] docs/03 + README updated to the new posture
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green
