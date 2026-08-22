// The two halves of the host-permission dance both registry forms on this
// page do around "Test connection" (decisions/09 for providers, decisions/14
// for MCP servers, which mirrors it): showing the user up front whether this
// extension may already contact the host they typed, and asking for the grant
// at the moment they press Test. Card 81 merged the two verbatim copies —
// ProviderForm.svelte's and McpServerForm.svelte's — into this module.
//
// A `.svelte.ts` module, not a plain one, because `trackHostPermission` owns
// a `$state` + `$effect` pair on the caller's behalf; it must be called
// during a component's initialisation, like any other rune.

import { originPatternForUrl } from "../../domain/permissions";
import { m } from "../../paraglide/messages.js";
import { optionsServices } from "../app-services";

/** The one sentence both forms show when the user declines the Chrome prompt. Their outcome types differ (`TestOutcome` vs `McpTestOutcome`), but the fact being reported, and so the wording, does not. A function, not a module-level constant, so it reads the active locale at call time rather than freezing whatever was active the moment this module first loaded. */
export function permissionDeniedMessage(): string {
  return m.hostPermission_permissionDeniedMessage();
}

/** Live grant state for a typed-in URL: `true`/`false` once known, `undefined` while the check is in flight or the URL isn't yet a valid http(s) origin. */
export interface HostPermissionState {
  granted: boolean | undefined;
}

/**
 * Track whether the host in `url()` is already granted, re-checking whenever
 * the typed URL changes, so a form can say up front that "Test connection"
 * will need to prompt. Writable: `requestHostPermission` below hands the
 * answer from a real prompt straight back through it.
 */
export function trackHostPermission(url: () => string): HostPermissionState {
  let granted = $state<boolean | undefined>(undefined);

  $effect(() => {
    const typed = url().trim();
    granted = undefined;
    if (!originPatternForUrl(typed)) return;
    optionsServices()
      .permissions.has(typed)
      .then((result) => {
        granted = result;
      });
  });

  return {
    get granted() {
      return granted;
    },
    set granted(next: boolean | undefined) {
      granted = next;
    },
  };
}

/**
 * Ensure this extension may contact `url`, prompting if the grant isn't
 * already known, and record the answer in `state`.
 *
 * MUST be the first `await` in the click-bound handler that calls it
 * (decisions/09): Chrome only honours `permissions.request` while still
 * inside the user gesture that triggered it, so nothing else may run ahead of
 * it. Returns whether the caller may proceed.
 */
export async function requestHostPermission(
  url: string,
  state: HostPermissionState,
): Promise<boolean> {
  if (state.granted === true) return true;
  const granted = await optionsServices().permissions.request(url);
  state.granted = granted;
  return granted;
}
