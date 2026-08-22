// The `chrome.permissions` implementation of `HostPermissions`
// (src/domain/permissions) — card 78.
//
// This module was `src/lib/permissions.ts`: the last piece of infrastructure
// left in the pre-DDD grab bag, and the named reason
// `.dependency-cruiser.cjs`'s `no-src-lib` rule stayed parked through cards
// 74-77. Two things changed on the way in, and nothing else did:
//
//   - `originPatternForUrl` went the OTHER way, into
//     src/domain/permissions/host-permissions.ts. It is pure URL parsing —
//     the rule "which origin pattern does this host need, and can it be
//     granted at all" — and every caller of it that is not asking the browser
//     for anything (McpServerForm's URL validation, the OAuth endpoint
//     sweep) now gets it from the domain instead of from an adapter.
//   - the free functions became a factory returning the port, so a composition
//     root injects ONE instance and `only-roots-construct-infra` has something
//     to enforce.
//
// `onChanged` is new here in shape only: it is the `chrome.permissions
// .onAdded`/`.onRemoved` pair that ProvidersSection.svelte and
// McpServersSection.svelte each subscribed to directly, so their
// "Permission needed"/"Permission granted" badges stay live when the user
// grants or revokes from chrome://extensions with the options page open.
// Those were four of the seven `chrome.*` call sites card 78 took out of the
// options components; the behaviour is unchanged, the caller is now handed a
// teardown instead of a listener pair.
//
// History, for the record: written once for the provider registry (card 22,
// as src/options/lib/permissions.ts), copied verbatim for the MCP registry
// (card 37, as src/lib/mcp/permissions.ts) because src/options/ was off
// limits to that card, consolidated by card 39, and finally de-shimmed here —
// both re-export shims are gone.

import type { HostPermissions } from "../../domain/permissions";
import { originPatternForUrl } from "../../domain/permissions";

/** Build the `chrome.permissions` adapter. One instance per composition root. */
export function createChromeHostPermissions(): HostPermissions {
  return {
    async has(url: string): Promise<boolean> {
      const pattern = originPatternForUrl(url);
      if (!pattern) return false;
      try {
        return await chrome.permissions.contains({ origins: [pattern] });
      } catch {
        return false;
      }
    },

    async request(url: string): Promise<boolean> {
      const pattern = originPatternForUrl(url);
      if (!pattern) return false;
      try {
        return await chrome.permissions.request({ origins: [pattern] });
      } catch {
        return false;
      }
    },

    onChanged(listener: () => void): () => void {
      const onAdded = () => listener();
      const onRemoved = () => listener();
      chrome.permissions.onAdded.addListener(onAdded);
      chrome.permissions.onRemoved.addListener(onRemoved);
      return () => {
        chrome.permissions.onAdded.removeListener(onAdded);
        chrome.permissions.onRemoved.removeListener(onRemoved);
      };
    },
  };
}
