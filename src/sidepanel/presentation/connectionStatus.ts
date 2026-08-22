// Wording for a `ConnectionStatus` (src/sidepanel/stores/panel.svelte.ts) —
// card 101's i18n extraction. Previously duplicated as an identical
// `Record<ConnectionStatus, string>` literal in both OverflowMenu.svelte and
// ContextChip.svelte (each flagged with its own clean-code DRY TODO); moved
// here, the same shape src/sidepanel/presentation/capabilityBadge.ts and
// toolOrigin.ts already establish for cross-component wording, so the two
// surfaces that show a connection status can no longer drift on the words.

import { m } from "../../paraglide/messages.js";
import type { ConnectionStatus } from "../stores/panel.svelte";

/** Display label for a connection status, shared by OverflowMenu.svelte's status line and ContextChip.svelte's tooltip/accessible name. */
export function connectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "unknown":
      return m.connectionStatus_unknown();
    case "connecting":
      return m.connectionStatus_connecting();
    case "connected":
      return m.connectionStatus_connected();
    case "disconnected":
      return m.connectionStatus_disconnected();
    case "error":
      return m.connectionStatus_error();
  }
}
