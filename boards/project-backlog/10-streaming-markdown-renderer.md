---
column: review
labels: [frontend]
priority: med
agent: claude
live: false
updatedAt: 2026-08-19T16:45:00.000Z
---
# Streaming markdown rendering

Assistant replies arrive token by token, so the renderer has to cope with
half-finished syntax — an unclosed fence, a dangling `**` — without flickering
or throwing.

Sanitisation is not optional: this text is influenced by page content returned
from tool results, which is untrusted (decisions/02-mainworld-webmcp-bridge.md).

## Checklist

- [x] Markdown to safe HTML, sanitised, no raw HTML passthrough
- [x] Tolerate incomplete syntax mid-stream
- [x] Code blocks with a copy button
- [x] Links open in a new tab with `rel="noopener noreferrer"`
- [x] Sensible rendering of JSON blobs in tool results

## Comments

- **claude** (2026-08-19T16:45:00.000Z): Implemented in two new files (no existing files touched, per card scope): `src/lib/markdown.ts:1` is the render pipeline (`renderMarkdown(source): string`), `src/sidepanel/components/Markdown.svelte:1` is the mountable component (`props: { source: string; class?: string }`). Pipeline: `balanceIncompleteMarkdown` (src/lib/markdown.ts:95) repairs mid-stream syntax — an unterminated fence is left untouched since CommonMark itself extends it to EOF (src/lib/markdown.ts:35-98), while dangling inline markers (`**`, `` ` ``, `~~`, `_`) in the currently-typing block (text after the last blank line) get a virtual closer appended for that render pass only, never mutating the caller's buffer — then `marked@18.0.10` parses (raw HTML tokens are escaped by a custom `html` renderer at src/lib/markdown.ts:216-228, not passed through), then `DOMPurify@3.4.14` sanitises with a strict tag/attr allowlist (src/lib/markdown.ts:232-268) as the final authority regardless of what marked produced. `<img>` is deliberately excluded from the allowlist (src/lib/markdown.ts:257-262 comment) — an attacker-controlled tool result could otherwise use an image src as a data-exfiltration channel. Every `<a>` is forced to `target="_blank" rel="noopener noreferrer"` and restricted to http(s)/mailto via a DOMPurify hook (src/lib/markdown.ts:271-289). Code blocks render with a language label and a copy button (src/lib/markdown.ts:207-229); the Svelte component wires a single delegated click listener (src/sidepanel/components/Markdown.svelte:35-59) so the button works without any inline `onclick` in the sanitised HTML (CSP-safe). JSON fences (` ```json ` or bare `{...}`/`[...]` content) are pretty-printed via `JSON.parse`/`stringify` when they parse, and fall back to raw text harmlessly while still mid-stream (src/lib/markdown.ts:120-142). Styling consumes only `src/lib/theme.css` tokens (src/sidepanel/components/Markdown.svelte:76-234), no hard-coded colours/spacing/radii. Added `marked` and `dompurify` to `package.json` dependencies; both are pure DOM/string libraries, grepped for `eval`/`new Function` (none found) and confirmed absent from the esbuild-bundled output too. Verified: `npm run check` 0 errors/0 warnings, `npm run build` green with no unsafe-eval warnings; fed a full test document through `renderMarkdown` at every 3-character split point plus a battery of XSS payloads (`<script>`, `onerror` img, `javascript:` links/hrefs, `<svg onload>`, `<iframe>`, image-based exfiltration attempt) at every single-character split point in a real browser via Playwright — zero exceptions thrown, zero payloads executed. Also mounted the actual Svelte component standalone at a 320px viewport to confirm text/table/code wrapping and the copy button's clipboard flow (button flips to "Copied" and re-enables after 1.5s) — screenshot and scratch harness were built/verified in the session scratchpad only, not committed. Not yet wired into `App.svelte` — that's the owning agent's job; component API is documented in the file's doc comment.
