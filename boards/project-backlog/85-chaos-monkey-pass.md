---
column: todo
labels: [infra, bug]
priority: med
updatedAt: 2026-08-22T14:00:00.000Z
---
# Chaos-monkey pass over the suites

Grow the unhappy-path coverage with `.claude/skills/chaos-monkey/SKILL.md`, as
decisions/30-vitest-test-pyramid.md calls for: `describe('chaos: …')` groups per
fault category, on top of the domain, infra and component suites. The
dependencies that can fail here are the model provider (Ollama NDJSON /
OpenAI-compatible SSE), `chrome.storage`, the message channel between background
worker, side panel and content relay, the page's WebMCP tools, and HTTP MCP
servers. Work the taxonomy category by category rather than stopping at the
obvious two or three, and where the intended behaviour genuinely is not decided
yet, write the best-guess expectation as `test.todo` instead of asserting
something arbitrary.

## Checklist

- [ ] provider stream faults: abort mid-message, garbage/partial SSE and NDJSON frames, never-responds, HTTP 500 and 429 — the turn ends idle rather than stuck streaming, the error is surfaced not swallowed, and the persisted session matches what the UI shows
- [ ] storage faults: quota exceeded mid-write, a half-written `chat:index`, corrupt JSON under `chat:<id>`, a `tabchat:<tabId>` pointer to a deleted chat — a clean domain error each time and no loss beyond the failed write
- [ ] message races: a `runtime:call-tool-response` for a superseded turn, `runtime:tools-updated` arriving after the tab closed, the same message delivered twice, the tab closed mid-turn, the panel reopened mid-stream, and a turn started while one is in flight
- [ ] auth and time: an OAuth token expiring mid-turn with refresh succeeding and with refresh rejected, a 401 from an MCP server mid-call, a missing API key, and the timeout-ladder edges (a tool call returning exactly at a rung boundary)
- [ ] duplicates and limits: duplicate tool-call ids inside one assistant message, a replayed approval decision, a huge tool result, an empty tool list vs `available:false` vs `restricted:true` (the three-state model must stay distinguishable), and context-length overflow
- [ ] encoding and partial failure: unicode/emoji/RTL and very long strings, HTML and markdown in model output rendering sanitized, a stream aborting mid-message, and tool call 2 of 3 failing — assert the transcript and session are left consistent
- [ ] every new case sits under a `describe('chaos: …')` block (so `vitest -t chaos` selects them), families of bad inputs use `test.each`, and undecided behaviour is flagged with `test.todo` or an explicit comment
- [ ] npm run check, npm test, npm run build and npm run verify green
