---
column: review
labels: [frontend]
priority: med
agent: claude
updatedAt: 2026-08-20T10:12:00.000Z
---
# Options page and settings

Approval policy and history controls. Built on the same tokens as the panel
(decisions/08-native-chrome-design-language.md). Provider registration/management
(base URL, API key, default model) is scoped separately in card 22
(decisions/10-provider-registry-and-credential-storage.md).

## Checklist

- [x] Approval policy: default / always confirm / auto-run all
- [x] Clear all stored sessions
- [x] Settings live in `chrome.storage.sync` where sensible, sessions stay local
- [x] Link out to the provider registry UI (card 22)

## Comments

- **claude** (2026-08-19T15:32:00.000Z): Descoped after cards 20-24 landed — provider connection config (base URL, keys, test connection, `permissions.request`) is card 22 now. Left here: approval policy, history controls, and the shared options-page shell both cards mount into.
- **claude** (2026-08-19T16:10:00.000Z): Built the two remaining pieces. `src/lib/settings.ts:23` exports `ApprovalPolicy` ("default" | "always-confirm" | "auto-run-all"), `getApprovalPolicy`/`setApprovalPolicy` over `chrome.storage.sync` key `settings:approvalPolicy`, and `onApprovalPolicyChange` for live updates — this is the exact contract card 09's approval UI should import. `src/options/components/SettingsSection.svelte` mounts at `src/options/App.svelte:16` (the documented point) as two `.section` cards: "Tool approval" (radio group over the three policies, `SettingsSection.svelte:167-176` wording the auto-run-all option's risk plainly — forms/deletes/live logged-in sites, no review chance — plus a `.note` block at `SettingsSection.svelte:180-187` stating annotations are page-supplied UX guidance, not a security boundary, per decisions/05) and "Chat history" (`SettingsSection.svelte:195-224`, listing `listSessionSummaries()` output — origin, message/tool-call counts, last-updated — before a "Clear all history (N)" button that calls `window.confirm` with the concrete counts, then `clearAllSessions()`; a `.note` at `SettingsSection.svelte:189-193` states plainly that history is stored unencrypted in `chrome.storage.local` and can contain authenticated page content, per decisions/07). Also added a same-page anchor from the history section to `#providers-heading` (card 22's `ProvidersSection`) satisfying the "link out to provider registry" item, since both now live on one options page. Verified with `npm run check` (0 errors) and `npm run build` (green), plus a Playwright pass against the built `dist/src/options/index.html` under a mocked `chrome.storage`/`chrome.permissions` — confirmed light/dark rendering, radio selection persisting to sync storage, the session list and confirm-dialog wording, and clear-all correctly emptying the list.
- **claude** (2026-08-20T10:12:00.000Z): Reordered the page so MCP servers sits above chat history. That meant splitting the history controls out of SettingsSection.svelte into their own src/options/components/HistorySection.svelte:1-138 — history was the third `<section>` inside SettingsSection, and McpServersSection is a sibling in App.svelte, so there was no way to interleave them without the split. SettingsSection keeps only the two approval policies and drops the session state, the three history helpers and the `.session-*`/`.btn-danger` rules that moved with them. Section order is now Chat providers, Tool approval, MCP server tool approval, MCP servers, Chat history (src/options/App.svelte:12-27) — configuration first, stored data last, with the one section that only ever deletes things at the bottom. The cross-references in both moved sections still read correctly: the MCP approval note points at MCP Servers "below", and history points at Chat providers "above".
