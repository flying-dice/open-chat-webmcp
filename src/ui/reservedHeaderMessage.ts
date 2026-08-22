// User-facing prose for the reserved-header rules that stop a custom
// request header from overriding one the client itself controls (card 107,
// decisions/15-custom-headers-are-credentials.md,
// decisions/37-i18n-paraglide.md).
//
// Two DOMAIN vocabularies feed this, one per bounded context, deliberately
// kept independent rather than merged into one (see the DRY TODOs on both:
// src/domain/providers/provider.ts's `reservedHeaderReason` and
// src/domain/tools/servers.ts's `validateServerHeaders`) — a provider
// config's rule depends on the provider TYPE and whether an API key is
// configured, an MCP server's depends on whether a bearer token is
// configured, and there is no shared source tying the two rules together.
// Both used to return their own hand-rolled English sentence that disagreed
// on contractions ("can't" vs "cannot") and quote style (card 103's
// journal). This is the one place both now funnel through — the same
// code/copy split src/ui/providerMessage.ts and src/ui/storageMessage.ts
// already establish for their own domain types — so the two forms that show
// this error (src/options/components/ProviderForm.svelte,
// src/options/components/McpServerForm.svelte) read one consistent,
// localized sentence per rule instead of two independently-worded ones.

import type { ReservedHeaderReason } from "../domain/providers";
import type { McpReservedHeaderCode } from "../domain/tools";
import { m } from "../paraglide/messages.js";

/** Localized copy for a provider config's reserved-header rule (`reservedHeaderReason`, src/domain/providers/provider.ts). */
export function providerReservedHeaderMessage(reason: ReservedHeaderReason): string {
  switch (reason.kind) {
    case "content-type":
    case "accept":
      return m.reservedHeader_wireFormat({ header: reason.header });
    case "authorization-api-key":
      return m.reservedHeader_authorizationApiKey();
  }
}

/** Localized copy for an MCP server's reserved-header rule (`validateServerHeaders`, src/domain/tools/servers.ts) — `header` is the offending header's own name, in whatever case the user typed it. */
export function mcpReservedHeaderMessage(header: string, code: McpReservedHeaderCode): string {
  switch (code) {
    case "client-controlled":
      return m.reservedHeader_clientControlled({ header });
    case "authorization-bearer-token":
      return m.reservedHeader_authorizationBearerToken();
  }
}
