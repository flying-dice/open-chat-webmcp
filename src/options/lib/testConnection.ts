// "Test connection" for the provider registry UI (card 22). Resolves
// through the provider's own `ChatProvider` client — built via
// `createProviderClient` (src/lib/providers/registry.ts) exactly the way
// the side panel would — never a bespoke fetch of our own, so a client's
// auth headers, wire quirks, and error classification are exercised for
// real rather than approximated here.
//
// The point of this module: collapse nothing. `ProviderError` (src/lib/provider.ts)
// already distinguishes auth failures, unreachable-or-CORS, "this endpoint
// doesn't support model listing", and a few other kinds — each gets its own
// outcome and its own plain-language fix below, instead of a single generic
// "connection failed".

import { createProviderClient, type ProviderConfig } from "../../lib/providers/registry";

export type TestOutcome =
  | { kind: "success"; modelCount: number }
  | { kind: "not-supported"; message: string }
  | { kind: "auth"; message: string }
  | {
      kind: "unreachable";
      message: string;
      /**
       * Carried straight through from `ProviderError`'s `unreachable-or-cors`
       * kind (src/lib/provider.ts) when the client supplied one — e.g.
       * Ollama's copyable `OLLAMA_ORIGINS`/`launchctl setenv` fix
       * (src/lib/ollama.ts's `originRejectedError`). `undefined` when
       * there's no single command to hand back. UI built on this should
       * render `fix.command` verbatim (see testResultDisplay.ts's sibling
       * doc), the same rule `ProviderError.fix` documents.
       */
      fix?: { label: string; command: string };
    }
  | { kind: "http"; message: string }
  | { kind: "invalid-response"; message: string }
  | { kind: "aborted" }
  | { kind: "permission-denied"; message: string }
  | { kind: "unexpected"; message: string };

/**
 * Run the actual connectivity probe: `listModels()` on a real client bound
 * to `config`. Assumes the caller has already secured any host permission
 * `config.baseUrl` needs (see src/options/lib/permissions.ts) — this
 * function makes no permission decisions itself, so it can be reused to
 * test an unsaved draft config as easily as a persisted one.
 */
export async function testProviderConnection(
  config: ProviderConfig,
): Promise<TestOutcome> {
  let client;
  try {
    client = createProviderClient(config);
  } catch (err) {
    // Only thrown for a provider type with no registered client factory
    // (registry.ts: a programming-error path, not a runtime/network one) —
    // surfaced plainly rather than silently swallowed.
    return {
      kind: "unexpected",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const result = await client.listModels();
  if (result.ok) {
    return { kind: "success", modelCount: result.value.length };
  }

  const error = result.error;
  switch (error.kind) {
    case "auth":
      return {
        kind: "auth",
        message: `Authentication failed (${error.status}). Check that the API key entered for this provider is correct and hasn't expired.`,
      };
    case "unreachable-or-cors":
      // Already carries a provider-specific fix (Ollama's client names the
      // OLLAMA_ORIGINS setting; OpenAI's points at the options-page
      // permission grant) — pass it straight through rather than
      // re-wording it. `fix` is passed through too now (card 33) — this
      // used to drop it, so the options page never rendered the copyable
      // command the side panel's picker already did.
      return { kind: "unreachable", message: error.message, fix: error.fix };
    case "not-supported":
      return { kind: "not-supported", message: error.message };
    case "http":
      return {
        kind: "http",
        message: `Provider returned ${error.status} ${error.statusText}${
          error.body ? `: ${error.body}` : ""
        }`,
      };
    case "invalid-response":
      return {
        kind: "invalid-response",
        message: `The response couldn't be understood: ${error.message}`,
      };
    case "aborted":
      return { kind: "aborted" };
  }
}
