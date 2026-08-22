// Wording for a tool's `ToolOrigin` — the UI half of decisions/19 §6
// ("every surface that names a tool must say where it runs").
//
// This used to be `originLabel` in src/lib/mcp/merge.ts. Card 73
// (decisions/29) moved it out: the domain owns the `ToolOrigin` CODE, the UI
// owns the words. `src/domain/tools` now decides only whether a tool came
// from the page or from a named server; this module decides that "the page"
// reads as "this page".
//
// Every surface that names an origin goes through here so none of them can
// drift on the phrasing: ApprovalCard, ToolCallRow, ToolListItem,
// CallLogEntry and ActivityIndicator all render it, and
// src/domain/chat's turn puts the same words in the system prompt so what the
// model is told matches what the approval card shows — it takes this function
// as an injected `originLabel`, since the wording is the UI's to own.

import type { ToolOrigin } from "../../domain/tools";
import { m } from "../../paraglide/messages.js";

/** Short label for `origin`, safe to render anywhere a tool is named — "this page" or the server's own display name. Never abbreviates or hides the server name: decisions/19 §6 is a correctness requirement, not decoration. */
export function originLabel(origin: ToolOrigin): string {
  return origin.kind === "page" ? m.thisPageLabel() : origin.serverName;
}
