// The plumbing ProvidersSection.svelte and McpServersSection.svelte share
// (card 113) — the two "a list of remote-endpoint configs with
// add/edit/remove/reorder and a test-connection flow" sections that
// McpServersSection's own header says are the same kind of section, "one
// field shape different".
//
// Four DRY markers named the same three pieces, typed out twice:
//
//   - the per-id host-permission grant map, refreshed in parallel and kept
//     live by `permissions.onChanged` (decisions/09 for providers,
//     decisions/14 for MCP servers, which mirrors it);
//   - the "check the cached grant -> `permissions.request` as the FIRST
//     `await` -> run the test, else report a permission-denied outcome" flow;
//   - card 95's write-failure line: a `failure` field plus the
//     `storageFailureMessage(what, cause)` that fills it.
//
// decisions/20's caution — an edit to one section must never silently change
// the other — is honoured by what is NOT here: nothing below knows which
// registry it is serving. It holds no port, no copy of its own beyond the one
// shared permission-denied sentence, and no branch on a config's shape.
// Each section still owns its own port calls, its own messages, and its own
// decision about what a failure means; what it borrows is bookkeeping.
//
// A `.svelte.ts` module because both factories own `$state` on the caller's
// behalf, same as ./hostPermission.svelte.ts. Neither owns an `$effect`, so
// both are constructible from a plain unit test.

import type { StorageError } from "../../domain/storage";
import { storageFailureMessage } from "../../ui/storageMessage";
import { m } from "../../paraglide/messages.js";
import { optionsServices } from "../app-services";

/** The two fields either registry's config exposes that this module needs: an identity to key state by, and the host to ask permission for. */
export interface RegistryEntry {
  id: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Card 95's write-failure line
// ---------------------------------------------------------------------------

export interface SectionFailure {
  /** The line to render above the list — `undefined` when the last read and write both landed. */
  readonly message: string | undefined;
  /** Record a failed read or write. `what` is the section's own description of the operation ("Couldn't load your providers"); `cause` is the port's own error. */
  report(what: string, cause: StorageError): void;
  /** Clear it — a later refresh succeeded. */
  clear(): void;
}

/**
 * A section's storage-failure line (card 95): a read that left the list stale,
 * or a write that did not land. Above the list, and never INSTEAD of it —
 * what is listed is still the last thing successfully read, and blanking it
 * would read as "your providers are gone", a worse lie than a stale list.
 *
 * The two FORM writes deliberately do not come through here: an add/edit
 * hands its error back to the still-open form so the message lands under the
 * fields the user would otherwise be asked to retype.
 */
export function createSectionFailure(): SectionFailure {
  let message = $state<string | undefined>(undefined);

  return {
    get message() {
      return message;
    },
    report(what: string, cause: StorageError): void {
      message = storageFailureMessage(what, cause);
    },
    clear(): void {
      message = undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Host-permission grants + the permission-gated connection test
// ---------------------------------------------------------------------------

/** The outcome shape both registries' test-outcome unions include — what this module hands back when the user declines Chrome's prompt. The two unions differ everywhere else; they agree here because the fact being reported is the same one. */
export interface PermissionDeniedOutcome {
  kind: "permission-denied";
  message: string;
}

/** The one sentence either section shows after a declined prompt. A function, not a constant, so it reads the ACTIVE locale at call time rather than freezing whatever was active when this module first loaded. */
export function permissionDeniedOutcome(): PermissionDeniedOutcome {
  return { kind: "permission-denied", message: m.permissionDeniedRetryMessage() };
}

export interface RegistryTestGate<O> {
  /** Grant state per config id. `undefined` while a check is in flight — kept distinct from a settled `false` so a badge never briefly flashes "needed". */
  readonly granted: Record<string, boolean | undefined>;
  /** The last test result per config id, or `undefined` if none has been run (or one is running now). */
  readonly outcomes: Record<string, O | undefined>;
  /** Whether a test for `id` is in flight — the row's button reads "Testing…". */
  isTesting(id: string): boolean;
  /** Re-check every listed config's grant, in parallel, replacing the map — so an id that is no longer listed leaves no entry behind. */
  refreshGrants(entries: RegistryEntry[]): Promise<void>;
  /** Drop a removed config's grant and outcome. */
  forget(id: string): void;
  /**
   * Run `entry`'s "Test connection", gated on its host permission.
   *
   * `permissions.request` MUST be the first `await` here when the grant isn't
   * already known-true (decisions/09, decisions/14): a click handler is the
   * only place the browser honours that request, and any async work ahead of
   * it risks losing the gesture. That is why `test` takes the connection
   * attempt as a THUNK — the caller cannot accidentally start it early.
   */
  test(entry: RegistryEntry, run: () => Promise<O>): Promise<void>;
}

/**
 * The permission + test-outcome bookkeeping for one registry list.
 *
 * `denied` builds the outcome for a declined prompt in the caller's own
 * outcome type; both sections pass {@link permissionDeniedOutcome}, which is
 * assignable to either union.
 */
export function createRegistryTestGate<O>(denied: () => O): RegistryTestGate<O> {
  let granted = $state<Record<string, boolean | undefined>>({});
  let outcomes = $state<Record<string, O | undefined>>({});
  let testing = $state<Record<string, boolean>>({});

  return {
    get granted() {
      return granted;
    },
    get outcomes() {
      return outcomes;
    },

    isTesting(id: string): boolean {
      return testing[id] ?? false;
    },

    async refreshGrants(entries: RegistryEntry[]): Promise<void> {
      const checked = await Promise.all(
        entries.map(
          async (entry) => [entry.id, await optionsServices().permissions.has(entry.url)] as const,
        ),
      );
      granted = Object.fromEntries(checked);
    },

    forget(id: string): void {
      delete granted[id];
      delete outcomes[id];
    },

    async test(entry: RegistryEntry, run: () => Promise<O>): Promise<void> {
      testing = { ...testing, [entry.id]: true };
      outcomes = { ...outcomes, [entry.id]: undefined };

      try {
        if (granted[entry.id] !== true) {
          const allowed = await optionsServices().permissions.request(entry.url);
          granted = { ...granted, [entry.id]: allowed };
          if (!allowed) {
            outcomes = { ...outcomes, [entry.id]: denied() };
            return;
          }
        }
        outcomes = { ...outcomes, [entry.id]: await run() };
      } finally {
        testing = { ...testing, [entry.id]: false };
      }
    },
  };
}
