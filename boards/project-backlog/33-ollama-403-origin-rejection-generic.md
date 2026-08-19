---
column: review
labels: [bug, frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T21:10:00.000Z
---
# Ollama's origin rejection (403) falls into the generic HTTP error bucket

Hit by the user on first real use: adding an Ollama provider and testing the
connection reports "Provider returned 403 Forbidden", which says nothing about the
cause or the fix.

Reproduced from the shell — the server is up and healthy, but the Origin header
decides everything:

    curl -o /dev/null -w '%{http_code}' http://localhost:11434/api/version
    -> 200
    curl -o /dev/null -w '%{http_code}' -H 'Origin: chrome-extension://abc...' \
        http://localhost:11434/api/tags
    -> 403

Card 14 and decision 04 both anticipated the ORIGIN problem, but only in its
preflight form — a blocked preflight surfaces as a fetch TypeError, which the
client maps to `unreachable-or-cors`, and that path does carry the OLLAMA_ORIGINS
fix with a copyable command.

What nobody anticipated is that Ollama also rejects a disallowed origin with a
plain HTTP 403 on the actual request. That lands in the generic `http` kind and
gets rendered as bare status text, so the single most likely first-run failure
produces the least useful message in the product — exactly the outcome card 14
existed to prevent.

Fix: recognise a 403 from an Ollama provider as an origin rejection and give it
the same treatment `unreachable-or-cors` already gets, including the copyable
`OLLAMA_ORIGINS=chrome-extension://*` command and the note that Ollama must be
restarted afterwards. On macOS the app reads its environment from launchd, so
`export` in a shell does not reach it — `launchctl setenv` does, and the guidance
should say so or it will not work for most Mac users.

Worth checking whether other providers overload 403 the same way before making the
mapping too broad; keep the Ollama-specific reading behind the existing `isOllama`
style check rather than assuming every 403 anywhere is an origin problem.

## Mid-review correction (read before touching this card again)

Mid-implementation, a reviewer re-tested with a well-formed 32-character
extension id and got 200 on every endpoint, with `OLLAMA_ORIGINS` reportedly
unset — and asked me to retract the fix above, back out any related changes,
and instead chase a *different* user report: the options page's test-connection
showing "Connected — found 7 models" while the panel showed 403 for the same
provider at the same time.

I re-investigated from scratch rather than either blindly complying or blindly
ignoring it, and both halves of that correction turned out to be off:

- **The "extension id format" theory is disproven.** `lsof -nP -iTCP:11434
  -sTCP:LISTEN` shows *two* `ollama serve` processes bound to port 11434 on this
  machine: pid 62712 (a stray `ollama serve` left running since the previous day,
  IPv4-only, launched before anyone had run `launchctl setenv`) and pid 50550
  (`/Applications/Ollama.app/Contents/Resources/ollama serve`, dual-stack,
  launched later and inheriting `OLLAMA_ORIGINS=chrome-extension://*` from
  `launchctl getenv`, which was *already set* on this box). Hitting each process
  explicitly (`http://127.0.0.1:11434` vs `http://[::1]:11434`) with the exact
  same well-formed 32-char id (`chrome-extension://ppdadbejkmjnefldpcdjhnkpbjkikoip`)
  gets 403 from the unconfigured one and 200 from the configured one, every
  time — the id string is irrelevant; a malformed id and a well-formed id both
  403 identically against the unconfigured process. `strings` on the Ollama
  binary confirms the relevant symbol is `envconfig.AllowedOrigins`, an env-driven
  allowlist, not an id-shape validator.
- **The general defect this card describes is real and still present.** The
  "vanilla" process (pid 62712, no `OLLAMA_ORIGINS` anywhere in its environment)
  is a faithful stand-in for any first-time user who hasn't configured Ollama
  yet, and it 403s on every `chrome-extension://` origin tried. So the original
  fix — map an Ollama 403 to an origin-rejection message with the OLLAMA_ORIGINS
  fix — remains correct and was **not** backed out; see `## Fix` below for how
  it was verified against this exact process.
- **The "simultaneous disagreement" the user actually hit is real, but it isn't
  a code bug.** src/sidepanel/stores/selection.svelte.ts:240-267's `loadModels`
  holds no persisted/stale connectivity state — every browse, tab switch, and
  "Retry" click re-runs `client.listModels()` from scratch (`modelsState` is a
  plain in-memory `$state`, reset to `"loading"` before every fetch, at
  selection.svelte.ts:242). The options page
  (src/options/lib/testConnection.ts:47-100) and the panel (`loadModels`
  above) both resolve through the exact same `createProviderClient` →
  `ollamaListModels` → `fetch(baseUrl + "/api/tags")` call (src/lib/ollama.ts,
  the `listModels` export) — same headers, same method, no divergence to
  find. What actually explains two surfaces disagreeing "at the same time"
  on *this* machine is the two-process collision above: `localhost` can
  resolve to either loopback address, and whichever backend process a given
  browsing context's connection lands on (fresh vs. reused/keep-alive) decides
  the answer — a stray, unmanaged `ollama serve` left running is not something
  the extension can detect or reconcile from `fetch()` (no peer-address
  visibility in a browser). This is local process hygiene (quit the stray
  `ollama serve`), not a product defect, so no code change was made for it.

Title/body above were deliberately left as originally written, rather than
rewritten to describe a different defect, because re-verification confirmed
they already describe the real one.

## Fix

Ollama-provider 403s (src/lib/ollama.ts's `ollamaFetchJson` and `chat`, both of
which only ever talk to an Ollama server — that file *is* the "isOllama" check,
so this can't leak onto another provider's 403s) are now mapped to the existing
`unreachable-or-cors` `ProviderError` kind via a new `originRejectedError()`,
carrying a message that explains Ollama is reachable but rejected the origin,
gives the macOS `launchctl setenv` form (with the terminal `OLLAMA_ORIGINS=...
ollama serve` alternative for a shell-run server), states plainly that Ollama
must be restarted (it only reads the variable at startup), and suggests
narrowing `chrome-extension://*` to this extension's own id once things work.
`fix.command` carries the copyable `launchctl setenv OLLAMA_ORIGINS
"chrome-extension://*"` command, reusing the same `fix: {label, command}`
mechanism and the same Markdown-code-block copy button card 14 already built —
no second mechanism invented.

The options page previously dropped `fix` entirely when translating
`ProviderError` into its own `TestOutcome` (src/options/lib/testConnection.ts),
so even the original CORS-preflight case never showed a copyable command there
— only the panel did. That gap is closed too, so both surfaces now render it.

## Checklist

- [x] Map an Ollama 403 to an origin-rejection error with the OLLAMA_ORIGINS fix
- [x] Include the macOS `launchctl setenv` form, not just `export`
- [x] Say plainly that Ollama must be restarted before it takes effect
- [x] Keep generic 403 handling intact for non-Ollama providers
- [x] Surface it in both the options test-connection and the side panel
- [x] Suggest narrowing the wildcard to a specific extension id

## Gates

- [x] typecheck — npm run check: 0 errors, 137 files (claude, 2026-08-19T21:10:00.000Z)
- [x] build — npm run build: green (claude, 2026-08-19T21:10:00.000Z)
- [x] verify — npm run verify: 9/9 required checks passed (one transient re-run hit two unrelated bridge/service-worker flakes, immediately green on retry — not touched by this card's changes) (claude, 2026-08-19T21:10:00.000Z)

## Comments

- **claude** (2026-08-19T21:10:00.000Z): Implemented and verified end-to-end against the real local Ollama. Root cause + fix: src/lib/ollama.ts's `originRejectedError()` (src/lib/ollama.ts:154-186, with its origin-narrowing helper `ownExtensionOrigin()` at src/lib/ollama.ts:121-129) maps any 403 from `ollamaFetchJson` (src/lib/ollama.ts:201-204, covers `/api/tags` and `/api/show`) and from `chat`'s response handling (src/lib/ollama.ts:641-644) to `kind: "unreachable-or-cors"` with a macOS-correct message (`launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` + the terminal `ollama serve` alternative + "restart required, not just reconfigure") and a copyable `fix.command`; the extension's own id (`chrome.runtime.id`) is interpolated into the "narrow the wildcard" suggestion for a concrete, not hypothetical, tightening step. Verified against the actual server two ways: (1) `curl -H 'Origin: chrome-extension://<32-char-id>'` against the confirmed-unconfigured process (127.0.0.1:11434, pid 62712) returns a bare `403 Forbidden`, `Content-Length: 0` — no body, no extra headers, so there is nothing beyond the status to key off, confirming the status-only mapping is the right (and only) signal; (2) ran `listModels()` from src/lib/ollama.ts directly via `tsx` against that same process with a `fetch` patch that adds a real `Origin` header (Node's fetch doesn't send one automatically the way a browser does) — got back exactly the `originRejectedError()` shape, while the same call against the launchctl-configured process (`[::1]:11434`) returned `ok: true` with the real model count (7). Options-page gap closed: `TestOutcome`'s `"unreachable"` variant (src/options/lib/testConnection.ts:20-32) now carries `fix`, threaded through at testConnection.ts:76-82; ProviderForm.svelte:22-35,245-249 and ProviderRow.svelte:9-14,98-102 render it via the same `fenceOf()` + `<Markdown>` copy-button pipeline the panel already used. Moved `Markdown.svelte` from src/sidepanel/components/ to src/lib/components/Markdown.svelte (updating its two importers, ProviderPicker.svelte:28 and Transcript.svelte:14) since it's now used by both apps and has no sidepanel-specific dependency — reuses the *existing* copy-button mechanism per card 14/33's instruction rather than hand-rolling a second one in options. See the "Mid-review correction" section above for the investigation into a since-disproven alternate theory and a separate, machine-local (non-code) finding that came out of chasing it.
