---
column: review
labels: [frontend]
priority: med
live: false
agent: claude
updatedAt: 2026-08-19T18:20:00.000Z
---
# Tools and call-log inspector

A second view in the panel showing what the page actually published and
everything the model did with it. This is the debugging surface for WebMCP sites
and the accountability surface for the user — nothing should happen invisibly
(decisions/05-tool-approval-policy.md).

## Checklist

- [x] Tools view: name, description, annotations, expandable input schema
- [x] Where each tool came from (native, polyfill, our shim)
- [x] Call log: args, result or error, duration, auto-run vs approved vs denied
- [x] Copy a call as JSON for bug reports
- [x] Live update as the page registers or unregisters tools
- [x] Empty state explaining what WebMCP is when a page publishes nothing

## Comments

- **claude** (2026-08-19T18:20:00.000Z): Built the inspector as a second panel
  view, wired in alongside the existing chat. `src/sidepanel/App.svelte:12-19,84-103`
  adds a `SegmentedControl` (`src/sidepanel/components/SegmentedControl.svelte`,
  a small generic pill tab-strip, decisions/08) that swaps the main area
  between the transcript+composer and the new `Inspector.svelte`
  (`src/sidepanel/components/Inspector.svelte`), which owns the inner
  Tools/Call Log switch.
  Tools view (`ToolsPanel.svelte`, `ToolListItem.svelte`, `ToolSchema.svelte`,
  `SchemaProperty.svelte`) renders each tool's name, description, and
  annotation badges, plus a `source` badge (native/polyfill/"our shim",
  decisions/02) with a tooltip explaining what each means; the input schema
  is a recursive, collapsible property list behind a chevron toggle, kept
  readable at 320px via indentation + `overflow-wrap: anywhere` rather than
  a raw JSON dump. Empty state (`ToolsPanel.svelte:29-47`) explains what
  WebMCP is and why most pages show nothing here, since that's the state
  most users will actually see first.
  Call Log view (`CallLogPanel.svelte`, `CallLogEntry.svelte`) lists
  `session.toolCalls` newest-first, reusing `ToolArgs.svelte`/
  `ToolArgValue.svelte` for arguments and results per the card's instruction
  rather than a third renderer. Each entry shows a mode badge
  (auto-run/approved/denied), duration, and a "Copy JSON" button
  (`navigator.clipboard.writeText`). Denied calls get the same danger
  border/badge treatment as an error, and start expanded like any
  human-reviewed call — decisions/05's "a denied call must be as visible as
  a successful one" (`CallLogEntry.svelte:17-33,142-152`).
  Live data plumbing: `panel.svelte.ts` gained two new read-only getters,
  `tools` and `toolCalls` (`src/sidepanel/stores/panel.svelte.ts:145-181`),
  populated by `activeTab.ts`'s existing `runtime:get-tools`/
  `runtime:tools-updated` flow — added a `setTools` setter there
  (`src/sidepanel/services/activeTab.ts:38-49,76-84,128-134`) alongside the
  pre-existing `setToolCount`, so the Tools view updates live off the same
  source rather than a second subscription. No new session-state owner:
  `toolCalls` reads through `session.toolCalls`, the same object
  `logToolCall`/`completeToolCall` already write.
  Verified with `npm run check` (0 errors), `npm run build` (green), and
  `npm run verify` (9/9 required checks passed, including the dynamic
  register/unregister and the always-throws/hangs-forever tool-call paths
  the demo page exists for). One caveat: `verify/checks/screenshots.mjs`
  opens the side panel as a plain tab (documented MV3 limitation — side
  panels can't be opened programmatically), so that screenshot's "0 tools"
  reflects the sidepanel's own extension-page tab, not the demo page — it
  confirmed the new Chat/Tools & Log switcher renders correctly in light and
  dark at 320px, but doesn't exercise real tool/call-log data end-to-end;
  that was validated by code review against the demo tool set in
  `demo/src/tools.ts` instead. Nothing in the live tool data looked wrong;
  the concurrent timeout-constant change (another agent, `hangs-forever`
  path) didn't touch anything this card depends on.
