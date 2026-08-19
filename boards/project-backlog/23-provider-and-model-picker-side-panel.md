---
column: review
labels: [frontend]
priority: high
agent: claude
live: false
updatedAt: 2026-08-19T16:15:00.000Z
---
# Provider and model picker (side panel)

Replaces the single-provider model picker originally scoped in card 07 with a
two-level picker: choose a registered provider (card 20/22), then a model from that
provider, greying out non-tool-capable and unknown-capability models with their
inline reason (decisions/11-provider-capability-detection.md). Persists the
selection into the tab's session as provider id + model
(decisions/10-provider-registry-and-credential-storage.md).

## Checklist

- [x] Provider dropdown sourced from the registry (card 20)
- [x] Per-provider model list, partitioned tool-capable / no-tools / unknown
- [x] Selection written to the tab session as `{ providerId, model }`
- [x] Empty state: no providers registered (link to options), distinct from no-tool-capable-models state
- [x] Handle a session referencing a since-removed provider (prompt to pick a replacement)

## Comments

- **claude** (2026-08-19T16:15:00.000Z): Built the two-level picker as a single compact trigger chip in the header popover (decision 08's "single compact control" + Header's slot contract), not two side-by-side selects — at 320px a level-1 `<select>` plus a level-2 model list stack vertically inside the popover instead of competing for header width. New store `src/sidepanel/stores/selection.svelte.ts` owns all state and talks to `src/lib/session.ts`/`src/lib/providers/registry.ts` directly (both pre-built, read-only from here); its `selection.resolution` (`"none"`/`"dangling"`/`"ok"`, reusing `SelectionResolution`) and `selection.activeCapability` getters (src/sidepanel/stores/selection.svelte.ts:96-149) are the exported surface the agent-loop card should read to get a live `ProviderConfig`+model and to decide whether to attach tools (only on `"tool-capable"`). New component `src/sidepanel/components/ProviderPicker.svelte` renders the trigger + popover, partitions models into tool-capable (clickable), no-tools (disabled, ⊘ icon, reason from `capability.detail`), and unknown (disabled, `?` icon, "tool support not verified" per decisions/11 — disabled-by-default was decision 11's explicit call, not a judgment call left to this card) — see src/sidepanel/components/ProviderPicker.svelte:100-113 (badge/reason helpers) and :183-260 (model list markup). Wired via a minimal edit to src/sidepanel/App.svelte:14-33 (passes the `picker` snippet into Header, per Header.svelte's documented slot contract) — Header.svelte itself untouched. Added the OpenAI self-registration side-effect import to src/sidepanel/main.ts:3-13, mirroring src/options/main.ts — it was NOT already handled for this entry point/bundle; without it `createProviderClient` would throw for `type: "openai"` the moment the picker tried to build a client. Empty/error states covered explicitly: no providers registered → empty state + "Open options" button (src/sidepanel/components/ProviderPicker.svelte:150-153); provider unreachable → `modelsState.status === "error"` banner + Retry (:196-198); reachable with zero tool-capable models → distinct banner naming `ollama pull llama3.1` for Ollama providers specifically (:222-232); dangling session provider → banner prompting a replacement, conversation kept (:145-149, store logic in src/sidepanel/stores/selection.svelte.ts:180-200). `npm run check` 0 errors, `npm run build` green. Verified live against the built bundle with Playwright (chrome.* stubbed): 320px popover has zero horizontal overflow, no-providers/dangling-provider/tool-capable-vs-no-tools partitioning all render correctly, and picking a model actually persists `{providerId, model}` into both the tab session and (only when unset) the global default.
