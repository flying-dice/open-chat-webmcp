// Runtime DEBUG FLAGS kept in `chrome.storage.local` (card 59 item 1, moved
// here from src/sidepanel/stores/panel.svelte.ts by card 77).
//
// Not a domain port and not modelling anything about the problem domain — it
// is a switch, and it lives in this folder for one reason: `chrome.storage`
// may only be called from here (card 74's containment scan,
// decisions/32-storage-ports-and-error-vocabulary.md). Before card 77 the
// panel store owned the key, the read and the `onChanged` listener directly,
// and was the single named exception in that scan. Moving the fifteen lines
// here removed the exception rather than renewing it.
//
// WHY A STORED FLAG RATHER THAN `import.meta.env.DEV` ALONE. Vite ties
// `import.meta.env.DEV` to the serve-vs-build COMMAND, never to `--mode`
// (confirmed empirically): it is `false` in EVERY artifact that can be loaded
// unpacked, including `npm run build`'s `dist/` — which is exactly what
// `npm run launch` (scripts/launch-chrome.mjs) builds and opens in Jonathan's
// real, day-to-day Chrome. A DEV-only gate would make sync-path tracing
// permanently dead in the one browser "make the next occurrence
// self-explaining" is actually for.
//
// WHY STORED RATHER THAN IN-MEMORY: the side panel's whole JS context is
// destroyed and recreated on every open/close, which would silently reset an
// in-memory toggle back to the DEV default mid-investigation.
//
// TO TURN TRACING ON in a real installed build, without editing any code:
// right-click the side panel → Inspect → paste into that devtools console:
//
//   window.__webmcpPanelDebug.enableTracing()
//
// (equivalently: `chrome.storage.local.set({ "debug:tab-sync-tracing": true })`).
// `disableTracing()` turns it back off. Every already-open panel/options page
// instance picks the change up immediately via the subscription below — no
// rebuild, no reload. scripts/dump-chat-storage.js's header repeats this exact
// one-liner, since that script is what gets pasted into the same console when
// this bites again; the two are meant to be found together.

import type { Result } from "../../domain/result";
import type { StorageError } from "../../domain/storage";
import { subscribeToKey, type StorageAreaGateway } from "./area";

const TRACE_FLAG_KEY = "debug:tab-sync-tracing";

/** A live boolean backed by `chrome.storage.local`: read synchronously, written asynchronously, kept in step across every extension page that holds one. */
export interface DebugFlag {
  /** The flag's CURRENT value — synchronous, so a hot path (`trace()` runs on every tab event) never awaits. Reads the default until the first stored value lands, a few ms after construction. */
  isEnabled(): boolean;
  /** Write the flag. Every open page's own `DebugFlag` sees it via `chrome.storage.onChanged`, not just the caller's. Returns the gateway's own `Result` (card 92) — this is a devtools-console affordance, so the failure lands where the caller can read it rather than being swallowed here. */
  set(enabled: boolean): Promise<Result<void, StorageError>>;
}

/**
 * The sync-path tracing flag (`[webmcp][tab-sync]`-prefixed logs). Reads the
 * stored value once at construction and stays subscribed for the surface's
 * lifetime; a cleared value falls back to `defaultEnabled`.
 *
 * Constructing this touches storage, unlike every other factory in this
 * folder — deliberately: the read has to have happened by the time the first
 * tab event arrives, and there is no later moment a caller would naturally
 * initialise it.
 */
export function createTracingFlag(local: StorageAreaGateway, defaultEnabled: boolean): DebugFlag {
  let enabled = defaultEnabled;

  // A storage failure here costs diagnostics, never behaviour — the flag
  // simply stays at its default, which is what ignoring the error member
  // says. Card 92: this used to be a `.catch(() => undefined)` on a
  // rejection nothing declared; now the ignored failure is a named value.
  void local.read(TRACE_FLAG_KEY).then(([stored]) => {
    if (typeof stored === "boolean") enabled = stored;
  });

  subscribeToKey("local", TRACE_FLAG_KEY, (newValue) => {
    enabled = typeof newValue === "boolean" ? newValue : defaultEnabled;
  });

  return {
    isEnabled: () => enabled,
    set: (next) => local.write({ [TRACE_FLAG_KEY]: next }),
  };
}
