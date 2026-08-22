---
name: chaos-monkey
description: >-
  Find the unhappy paths the existing test suite doesn't cover and write them up as new test cases.
  Use whenever the user wants to harden, stress, or find gaps in the Vitest suites or the verify
  harness, or mentions a "chaos monkey", negative testing, edge cases, failure modes, or unhappy
  paths. Trigger even on a casual "think of ways to break this" or "what are we not testing?".
---

# Chaos Monkey

You are a chaos monkey loose in the test suite. The existing tests describe the happy path — the
well-behaved user getting the expected result. Your job is to find every way the system could break and
capture each as a new test case in the relevant suite.

## Method

1. **Read** the happy-path tests (Vitest `*.test.ts` files and the `verify/` harness scenarios). Note
   the actors, every precondition, every input, and every dependency — each one is something that can
   be absent, malformed, out of order, or fail. In this extension the dependencies are: the model
   provider (Ollama / OpenAI-compatible HTTP), chrome.storage, the message channel between background
   worker / side panel / content script, the page's WebMCP tools, and HTTP MCP servers.
2. **Hunt.** Don't stop at the two or three obvious negatives. Work the taxonomy below category by
   category and keep pushing: for each input ask what the *worst* value is, for each step ask what
   happens if it's skipped or repeated, for each dependency ask what happens when it dies. The
   interesting bugs hide past the obvious ones — chase the weird, the rare, and the "surely nobody
   would do that" until the category is genuinely exhausted.
3. **Write** each worthwhile failure as a test in the relevant suite. Match the repo's existing
   phrasing and style so it reads like the rest of the suite; don't duplicate what's already there.
   Group new cases under a `describe('chaos: …')` block so they're easy to run or exclude
   (`vitest -t chaos`).

## Where to look

| Category | Ask |
|---|---|
| Invalid input | wrong type/format, garbage JSON from the model, malformed tool-call arguments, injection-looking strings in page/tool content |
| Boundaries | 0, −1, max, max+1, empty transcript, empty tool list, off-by-one on pagination/truncation |
| Missing data | required field omitted, null, empty list, whitespace-only, storage key absent or half-written |
| Auth | missing/expired API key, OAuth token expired mid-turn, refresh fails, 401/403 from provider or MCP server |
| State & order | messages arriving out of order, acting on a deleted chat, tab closed mid-turn, panel reopened mid-stream |
| Duplicates | same message delivered twice, duplicate tool-call ids, replayed approval, duplicate storage index entries |
| Concurrency | two surfaces writing one chrome.storage key, two tabs driving one chat, turn started while one is in flight |
| Dependencies | provider 500s, times out, streams partial/garbage SSE, unreachable; MCP server dies mid-call; page navigates away |
| Limits | context-length overflow, rate limit, huge tool result, storage quota exceeded |
| Time | token expiry boundary, timeout ladder edges, clock skew between surfaces |
| Encoding | unicode, emoji, RTL, very long strings, HTML/markdown in model output (must render sanitized) |
| Partial failure | stream aborts mid-message, tool call 2 of 3 fails — is the transcript/session left consistent? |

`references/chaos-taxonomy.md` has sharper provocations and examples per category — read it to go deep.

## What good looks like

- **One behaviour per test**, asserting the failure *and* the expected handling (clean rejection,
  helpful message, state unchanged) — so it documents intended behaviour, not just pokes the system.
- **`test.each`** for families of bad inputs that share an expected outcome.
- **Realism over volume.** Ten sharp, plausible unhappy paths beat fifty contrived ones. Skip failure
  modes that can't occur for this feature.
- **When the intended behaviour is unknown** (what *should* happen when the provider times out?),
  write your best-guess expectation and flag it with `test.todo` or a comment rather than asserting
  something arbitrary.
- Security-flavoured tests assert that bad input is safely *rejected* or sanitized — not working
  exploits.

## Example

Happy path:

```ts
test('a completed turn is appended to the transcript', async () => {
  const chat = await startTurn(session, 'hello')
  expect(chat.messages.at(-1)).toMatchObject({ role: 'assistant', complete: true })
})
```

Chaos:

```ts
describe('chaos: provider stream failures', () => {
  test.each([
    ['aborts mid-message', abortAfter(3)],
    ['emits malformed SSE', garbageChunk()],
    ['times out before first token', neverResponds()],
  ])('turn ends cleanly when the stream %s', async (_name, fault) => {
    const chat = await startTurn(sessionWith(fault), 'hello')
    expect(chat.turnPhase).toBe('idle')          // not stuck "streaming"
    expect(chat.messages.at(-1).error).toBeDefined() // surfaced, not swallowed
    expect(await store.load(chat.id)).toEqual(chat)  // persisted state consistent
  })
})
```
