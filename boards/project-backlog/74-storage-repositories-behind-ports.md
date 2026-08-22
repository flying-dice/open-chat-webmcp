---
column: todo
labels: [backend, infra]
priority: high
updatedAt: 2026-08-22T13:05:00.000Z
---
# Storage repositories behind ports

Pull every `chrome.storage` call site out of `src/lib` into adapters under
`src/infra/chrome-storage` implementing ports the domain owns, per
decisions/29-ddd-hexagonal-typescript-layout.md and the driven-port rules in
`.claude/skills/ddd-hexagonal/SKILL.md`. The offenders are `src/lib/session.ts`
(814 lines, ~24 `chrome.storage.local` sites, keys `chat:<id>` / `chat:index` /
`tabchat:<tabId>`), `src/lib/providers/registry.ts` (398, ~15 sites),
`src/lib/mcp/registry.ts` (395, ~14 sites and a near-identical twin of the
provider registry), `src/lib/settings.ts` (132, ~13 sites) and `src/lib/ollama.ts`
(746), which keeps its own out-of-registry config store under `ollama:baseUrl` and
`ollama:cap:<model>`. The sync/local credential split is a hard rule and must
survive untouched: secrets never enter sync, and header values count as secrets.
Pre-release means storage shapes are free to change — the legacy `session:*`
migration path is deleted rather than ported.

## Checklist

- [ ] `ChatStore`, `ProviderRegistry`, `McpServerRegistry` and `SettingsStore` port interfaces declared in their owning domain contexts, each with a domain storage-error vocabulary (`Unavailable | NotFound | Conflict | Corrupt | Unexpected` carrying `cause`); adapters map quota errors, `chrome.runtime.lastError` and malformed JSON into it so no platform error escapes infra
- [ ] `session.ts`'s ~24 storage sites collapse into one chat repository owning `chat:<id>`, `chat:index`, `tabchat:<tabId>`, the 400ms/2000ms debounce, the `MAX_RETAINED_CHATS` 400 eviction backstop and `withIndexLock`; the aggregate rules (message append, tool-call log, title) stay in `domain/chat`
- [ ] `providers/registry.ts` and `mcp/registry.ts` CRUD extracted into two adapters over ONE shared keyed-record mechanic (list key in sync, per-id credential keys in local) — the near-duplicate is written once and both registries configure it
- [ ] sync/local split preserved exactly: `providers:list`, `providers:default`, `mcp:servers:list`, `settings:approvalPolicy`, `settings:mcpApprovalPolicy` in sync; `providers:apiKey:<id>`, `providers:headers:<id>`, `mcp:auth:<id>`, `mcp:headers:<id>` in local — verified by reading back the sync namespace after a save and asserting no secret is present
- [ ] `ollama:baseUrl` and `ollama:cap:<model>` leave `src/lib/ollama.ts` for a proper store — folded into the provider config space or its own repository behind the same port style; no module keeps a private storage side-door
- [ ] legacy `session:*` / `session:index` migration code and the `chat:migrated-from-tab-sessions:v1` flag deleted, not ported (pre-release: no migrations); `session.ts` also stops re-exporting `SelectionResolution` from `providers/registry` — that type lives in `domain/providers`
- [ ] `grep -rn "chrome.storage" src/` returns hits only under `src/infra/chrome-storage/` (plus any composition-root wiring), and `npm run guard:boundaries` proves no domain module reaches for it
- [ ] npm run check, npm run build, npm run guard and npm run verify green
