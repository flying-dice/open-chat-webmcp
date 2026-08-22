// INTERIM WIRING — read this before using it.
//
// Card 74's brief: "composition roots construct the adapters and inject
// them. Avoid a service locator; module-level wiring files that the root
// initializes are acceptable as an interim (journal it for card 77/78 if you
// take that shortcut)." This is that shortcut, taken deliberately and scoped
// to be easy to delete.
//
// Why not full injection now: the callers of these ports are today ~20 Svelte
// components, three Svelte 5 rune stores and two services, none of which take
// dependencies at all — a component reads `listProviders()` as a module
// import. Threading seven ports down through them is not a storage change, it
// is the UI change cards 77 and 78 exist for (`ui-does-not-import-infra` in
// .dependency-cruiser.cjs is parked for exactly those two cards). Doing it
// here would have doubled this card and buried the storage extraction inside
// a UI refactor.
//
// Why this is not a service locator: nothing looks a port up BY NAME at call
// time, and nothing registers into it. It is one eagerly-built bundle,
// exported as ordinary bindings, so the import graph still shows precisely
// which module depends on which port — which is what a locator destroys and
// what `npm run guard:boundaries` needs in order to have anything to say.
//
// HOW CARD 77/78 DELETES THIS: each surface's composition root
// (src/sidepanel/main.ts, src/options/main.ts) already calls
// `initChromeStorage()` and holds the result. When the stores and components
// take their ports as arguments (or Svelte context) instead of importing
// them, the roots pass that bundle down, the named exports below lose their
// last importer, and this file goes away with them. Nothing else has to
// move.

import { createChromeStoragePorts, type ChromeStoragePorts } from "./ports";

/**
 * The single shared bundle. Built at module scope — which is safe here
 * because building it touches no storage and registers no listeners: every
 * factory in this folder only closes over an area gateway. The first actual
 * `chrome.storage` call happens when a caller calls a port method.
 */
const ports: ChromeStoragePorts = createChromeStoragePorts();

/**
 * What a composition root calls. Returns the same bundle the named exports
 * below alias, so a root that holds the result and a module that imports
 * `providerRegistry` are talking to the same objects — in particular the
 * same `chatStore`, whose debounce map and index-write queue must not be
 * duplicated within a surface (see `createChromeStoragePorts`).
 */
export function initChromeStorage(): ChromeStoragePorts {
  return ports;
}

export const chatStore = ports.chatStore;
export const providerRegistry = ports.providerRegistry;
export const mcpServerRegistry = ports.mcpServerRegistry;
export const mcpAuthTokenStore = ports.mcpAuthTokenStore;
export const settingsStore = ports.settingsStore;
export const providerDefaults = ports.providerDefaults;
export const modelCapabilityCache = ports.modelCapabilityCache;
export const tracingFlag = ports.tracingFlag;
