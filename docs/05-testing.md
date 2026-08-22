# Testing

Two executable layers, deliberately shaped differently
([decisions/30](../decisions/30-vitest-test-pyramid.md)):

```
                 ┌─────────────────────────────────────────────┐
  npm run verify │ verify/ — real Chrome for Testing, the built │  ~1 min
                 │ extension, a real WebMCP page. 9 checks.     │
                 └─────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────┐
            │ component — jsdom + @testing-library/svelte, over    │
            │ fake ports. src/{sidepanel,options,ui}/**/*.test.ts  │
            ├─────────────────────────────────────────────────────┤
  npm test  │ infra — real adapters, in-memory chrome.storage      │  ~6s
            │ fake, stubbed fetch. src/infra/**/*.test.ts          │
            ├─────────────────────────────────────────────────────┤
            │ domain — bare Node, ZERO platform mocks.             │
            │ src/domain/**/*.test.ts                              │
            └─────────────────────────────────────────────────────┘
```

## `npm test` — the Vitest layer

One `vitest.config.ts`, two projects.

### `domain` (environment: `node`)

Covers `src/domain/**/*.test.ts` **and** `src/infra/**/*.test.ts`. Node, not
jsdom, on purpose: the domain must run with zero mocks of platform APIs, and
jsdom would make it too easy to reach for one by accident. That property is
not a convention here — `npm run guard:boundaries` fails the build if a
`src/domain` module so much as names `chrome.`, `fetch(`, `document.` or a
Svelte rune (see [Architecture → The guards](01-architecture.md#the-guards)).

Domain tests import the context barrel and exercise rules directly: the agent
turn's iteration cap and approval gating, transcript grouping, the merge
algebra's namespacing, selection resolution's dangling case, the approval
policies.

Infra tests exercise a real adapter against a fake platform, and the mapping
of platform failures into the domain's error vocabulary is the point:

| Test double | Stands in for | Lives in |
| --- | --- | --- |
| `createFakeChromeStorage()` / `installFakeChromeStorage()` | `chrome.storage.sync`/`.local` and `chrome.storage.onChanged`, plus `failNext(op, error)` for injecting a quota rejection | `src/infra/chrome-storage/testing/fake-chrome-storage.ts` |
| the fetch stub | every wire client's HTTP, including SSE and NDJSON streams — **no test makes a network request** | `src/infra/testing/fetch-stub.ts` |
| the storage fixture | one realistic seeded profile: six chats (one with the full tool-call sequence, one clean run), a provider, an MCP server, both approval policies | `src/infra/chrome-storage/testing/storage-fixtures.mjs` |

That last one is shared with the verify harness — see
[The fixture both layers seed from](#the-fixture-both-layers-seed-from).

### `component` (environment: `jsdom`)

Covers `src/sidepanel/**`, `src/options/**` and `src/ui/**`. Components are
driven through `@testing-library/svelte` over **fake ports** — each Svelte
surface has a `testing/fake-services.ts` that satisfies the same
`app-services` shape its composition root fills in production, so a component
test never starts a background worker, never touches `chrome.*`, and never
opens a socket. `vitest.setup.ts` registers jest-dom's matchers for this
project only.

The `browser` resolve condition is forced for this project: jsdom being the
environment only supplies globals; without that condition
`vite-plugin-svelte` picks the SSR compile target and `mount` is unavailable.

### Asserting a failure

Since [decisions/34](../decisions/34-errors-as-values.md) a known failure is a
returned value, so a failure test is an ordinary assertion — no
`rejects.toThrow`, and none of the unhandled-rejection flakes that came with
it. Destructure the tuple and check the error member:

```ts
const [chat, err] = await store.getChat("missing");
expect(err).toEqual({ kind: "not-found" });
expect(chat).toBeUndefined();
```

Assert the whole error object where you can (`toEqual`), not just its `kind`:
the extra fields are what a surface words the message from, and a test that
only checks the discriminant will not notice one going missing.

`throw` now means a bug, so `expect(...).toThrow()` is reserved for the seven
allowlisted invariant assertions — a test asserting a throw anywhere else is
testing behaviour that should have been a `Result`.

**Negative type probes.** The narrowing `Result` buys is a *compile-time*
property, and a test that only runs cannot protect it. Four files carry
`@ts-expect-error` probes that assert the compiler still REFUSES the unsafe
read — `src/domain/result.test.ts` for the kernel, and one per vocabulary in
`src/domain/tools/types.test.ts` (`McpError`),
`src/domain/providers/provider.test.ts` (`ProviderError`) and
`src/infra/ollama/client.test.ts`:

```ts
const [value, err] = await loadName();
// @ts-expect-error `value` is `string | undefined` until the error member is checked.
const name: string = value;
```

These run under `npm run check`, not `npm test`: `tsconfig.app.json` includes
`*.test.ts`, so an unused `@ts-expect-error` is itself a typecheck error. That
inversion is the point — if someone widens the success arm's `error` member to
`E | undefined` and quietly kills the narrowing, the *probe* stops erroring and
the build fails on the now-unnecessary suppression. `provider.test.ts` says so
in its own header.

The same probes cover the vocabularies' closedness: `{kind:"quota"}` is
rejected as a `ProviderError` because a client that hits a failure mode the
union does not cover must widen the union, never smuggle a bespoke error
through.

### Reading the output

`npm test` reports `expected fail` and `todo` counts alongside passes. Both
are deliberate:

- **`it.fails(...)`** marks a test that documents a **known bug** — it asserts
  the correct behaviour and is expected to fail until the bug is fixed. It
  turns green-by-accident into a loud failure the day someone fixes it, which
  is when the marker should be removed. Two exist today (a duplicate-call-id
  resolution bug in `src/domain/chat/turn.ts`, and a turn-active reporting bug
  across overlapping turns in `src/domain/chat/service.ts`); both are queued
  for the improvement sprint, and each test's own comment states the bug and
  the shape of the fix.
- **`it.todo(...)`** marks a case identified as worth covering that has no
  test yet.

Neither is a failure of the suite, and neither may be used to silence a test
that simply broke.

## `npm run verify` — the end-to-end gate

`node verify/run.mjs`. It builds the extension into its own `dist-verify/`
(never `dist/`, so a concurrent `npm run build` cannot corrupt a run),
resolves and launches **real, headed Chrome for Testing** with
`--enable-features=WebMCP` and the extension loaded unpacked, starts (or
reuses) the demo fixture server, and drives the actual running extension.

Nine required checks, every one a real observable browser behaviour rather
than a re-read of build output:

1. tool discovery against `document.modelContext.getTools()`;
2. the per-tab registry clearing on navigation;
3. live register/unregister propagating through `ontoolchange`;
4. a tool call round-tripping through `executeTool()` with parsed MCP
   content;
5. a mutating call plus a rich-schema call;
6. a throwing tool surfacing as a clean error, not a hang;
7. a hanging tool hitting the **relay's own** 20s rung of the timeout ladder —
   asserted against `RELAY_EXECUTE_TIMEOUT_MS` imported from
   `src/infra/webmcp/timeouts.mjs`, the same constant the extension ships;
8. the registry recovering after the MV3 service worker is really killed over
   CDP;
9. a second browser launched **without** the WebMCP flag reporting the
   distinct `available: false` state rather than an empty tool list.

Plus one **best-effort** check: the screenshot matrix.

While iterating on one of them, `npm run verify -- --check <name>` runs that
check alone and `-- --list` prints the names; the report says which checks
were skipped and why, and a skipped check counts as neither passed nor
failed. The build, the demo server, the browser launch and the setup between
checks still run, because the later checks depend on that shared state — so
it is a shorter report, not a faster gate. Two further passes are
**deliberately not** part of this gate, since neither is something a required
gate may assume: `npm run verify:smoke` (the options-page form smoke) and
`npm run verify:smoke:live` (a real end-to-end turn, which needs a local
Ollama with a tool-capable model and exits 0 when Ollama isn't reachable).
Both are described in [docs/07-development.md](07-development.md#tiers).

Chrome for Testing specifically, because Playwright's bundled Chromium has no
WebMCP compiled in at all and branded Google Chrome refuses `--load-extension`
outright. It is downloaded on first run via `@puppeteer/browsers` and cached
under gitignored `.chrome-for-testing/`. It needs a graphical environment (MV3
extensions require a headed launch). It does **not** need Ollama or any
provider configured.

### The screenshot matrix

`verify/checks/screenshots.mjs` writes 11 PNGs to gitignored
`verify/output/screenshots/`:

| Shots | What |
| --- | --- |
| `sidepanel-{light,dark}-{320,400}w` | the panel at both themes and both widths — 320px is Chrome's minimum side-panel width |
| `sidepanel-dark-menu`, `sidepanel-dark-model-sheet` | the two anchored surfaces, which are dismissed by any outside click and so never appear in an ordinary capture |
| `sidepanel-dark-activity-{expanded,payload,collapsed}` | the activity timeline in all three of its states ([decisions/26](../decisions/26-transcript-activity-groups-and-turn-phase.md)) |
| `options-{light,dark}` | the options page, full-page, with all four sections populated from the fixture |

**Best effort, but never silent.** A broken render here reports SKIP rather
than failing the run — but every locator the matrix depends on is a hard
requirement (`requireLocator`), and the full expected shot list is asserted
before the check returns. A drifted accessible name or hook class therefore
produces a SKIP *naming the shot that vanished*, not a PASS with a shorter
file list.

Most of what the check clicks it finds by **role and accessible name**, which
means renaming a button breaks the matrix loudly. Three styling-free hook
classes are the exception — `.picker__trigger`, `.activity-group .summary`,
`.step .row-head` — kept because those elements' accessible names are seed
data (a model id, a tool name) rather than fixed copy. Each is commented as
such where it is defined.

### The fixture both layers seed from

`src/infra/chrome-storage/testing/storage-fixtures.mjs` is the single
description of a seeded profile, consumed by the Vitest suite *and* by the
screenshot check.

It is plain `.mjs` with JSDoc types, for the same reason
`src/infra/webmcp/timeouts.mjs` is: `verify/` is real Node ESM with no build
step, so it cannot import TypeScript, but it can import that file by its
literal path — and `tsconfig.app.json`'s `allowJs`+`checkJs` mean
`npm run check` typechecks its records against the real `ChatSession`,
`TranscriptEntry`, `ProviderConfigCore` and `McpServerConfigCore` types
anyway.

The check that makes it trustworthy is
`storage-fixtures.test.ts`: it seeds the in-memory `chrome.storage` fake with
the fixture exactly as the harness seeds a real profile — a raw `set`,
bypassing every adapter — and then reads it back **through the production
adapters**, asserting among other things that the hand-written `chat:index`
matches what the domain's own `summarizeChat` derives. Before card 86 the
harness carried its own copy of these records, and it had already drifted (no
`createdAt` on transcript entries; a `defaultModel` field no provider type
has) without anything noticing, because `chrome.storage` accepts any JSON and
the adapters' decoders are deliberately defensive. Drift now breaks
`npm test`.

## The release gate

All five, green, in this order:

```
npm run check     # svelte-check + tsc, no build output (tests included)
npm test          # Vitest: domain + infra + component
npm run build     # the real MV3 bundle into dist/
npm run guard     # biome · boundaries · clean-code · return-types · throws
npm run verify    # Chrome for Testing, end to end
```

This is what the `pre-commit` skill runs and what a card records as evidence
in its `## Gates` section. `npm run test:coverage` adds a v8 coverage report
scoped to `src/domain` and `src/infra`. Running one file, one test or one
verify check while you work on it — and the `npm run dev:chrome` loop those
gates sit behind — is [docs/07-development.md](07-development.md).

Growing the unhappy-path coverage is the `chaos-monkey` skill's job:
`describe("chaos: …")` groups, one per fault category (storage quota
exhausted, a stream that dies mid-token, a tab that closes mid-call, markup
that tries to escape the markdown sanitizer). There are a couple of dozen
such groups today; they are ordinary Vitest, just named so a reader can see
at a glance which suites are about failure rather than about the happy path.
