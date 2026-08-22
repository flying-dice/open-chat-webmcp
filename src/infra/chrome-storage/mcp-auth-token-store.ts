// `McpAuthTokenStore` (src/domain/tools) — where a token set the OAuth
// adapter just refreshed actually lands (card 76).
//
// Implemented OVER `McpServerRegistry` rather than as a second keyspace of
// its own. Card 76's checklist floated a dedicated `mcp:auth:<id>` key, but
// card 74 had already made `auth` a credential PART of the server record
// (./mcp-server-registry.ts, in `chrome.storage.local` per decisions/15 and
// decisions/32's keyed-record mechanic). A separate key would give one
// credential two homes: `McpServerConfig.auth` — what the options form
// renders, what `McpServerRow` badges as "reconnect needed", and what the
// transport reads on the next connect — would still come from the registry
// and would silently disagree with the refreshed copy. So the port narrows
// the registry instead of shadowing it: the byte written here is the byte
// every reader already reads.
//
// What the port buys even so is the thing card 76 is actually about: the
// TRANSPORT can no longer do anything to a stored server except replace its
// token. `updateServer` can rename it, disable it, rewrite its URL and its
// headers; `saveAuth` can do one thing. src/infra/mcp only ever sees the
// latter.

import { fail, ok } from "../../domain/result";
import type { StorageError } from "../../domain/storage";
import type { Result } from "../../domain/result";
import type { McpAuthTokenStore, McpOAuthAuth, McpServerRegistry } from "../../domain/tools";

/**
 * Narrow `registry` to the one write the OAuth adapter is allowed to make.
 *
 * An unregistered `serverId` — notably the literal `"draft"` the options
 * form tests an unsaved server under — resolves without storing anything,
 * because that is what `updateServer` does for an unknown id. The caller
 * treats persistence as best-effort either way (src/infra/mcp/oauth.ts's
 * `getValidAuth`).
 */
export function createChromeStorageMcpAuthTokenStore(
  registry: McpServerRegistry,
): McpAuthTokenStore {
  return {
    async saveAuth(serverId: string, auth: McpOAuthAuth): Promise<Result<void, StorageError>> {
      const [, err] = await registry.updateServer(serverId, { auth });
      // The `undefined` record `updateServer` hands back for an unregistered
      // id is deliberately DISCARDED rather than reported: an unknown id is a
      // no-op by contract (see this function's doc comment), not a failure.
      return err ? fail(err) : ok();
    },
  };
}
