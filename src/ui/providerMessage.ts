// User-facing prose for a `ProviderError` (card 102,
// decisions/37-i18n-paraglide.md, decisions/34-errors-as-values.md).
//
// The domain vocabulary is `ProviderError` (src/domain/providers/provider.ts)
// — a `kind` discriminant plus whatever data each kind carries (status,
// statusText, body, message). That file ALSO exports its own
// `describeProviderError`, kept deliberately English and unchanged: two
// domain-internal consumers (`src/domain/chat/turn.ts`'s terminal-error
// transcript message, and `resolveCapability` in
// src/domain/providers/capability.ts) call it directly and are out of this
// card's scope (see that function's own doc comment for the full reasoning).
//
// THIS is the one both UI surfaces should import instead, for the same
// reason src/ui/storageMessage.ts exists: a surface that needs localized,
// user-facing prose for a domain error builds it here, once, rather than
// each surface (or the domain layer) hand-rolling its own copy. Card 102's
// two direct call sites are src/sidepanel/stores/selection.svelte.ts and
// src/options/components/ProvidersSection.svelte's provider-list-load
// failure path.
//
// Only the `"unreachable-or-cors"`/`"not-supported"` arms still pass
// `error.message` straight through — that text originates in an infra
// client (Ollama's/OpenAI's own wire-error prose, e.g. Ollama's copyable
// `OLLAMA_ORIGINS` fix), not this module, and localizing infra-authored
// strings is the same larger-scope debt turn.ts/sign-in.ts already carry
// (card 101's journal) rather than something this function can fix alone.

import type { ProviderError } from "../domain/providers";
import { m } from "../paraglide/messages.js";

/** Ready-made, LOCALIZED user-facing copy for a {@link ProviderError}. */
export function describeProviderError(error: ProviderError): string {
  switch (error.kind) {
    case "unreachable-or-cors":
      return error.message;
    case "aborted":
      return m.provider_requestCancelled();
    case "auth":
      return m.provider_authFailed({ status: error.status, message: error.message });
    case "http":
      return m.provider_httpError({
        status: error.status,
        statusText: error.statusText,
        detail: error.body ? `: ${error.body}` : "",
      });
    case "not-supported":
      return error.message;
    case "invalid-response":
      return m.provider_invalidResponse({ message: error.message });
  }
}
