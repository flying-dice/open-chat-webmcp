// The story surface's COMPOSITION ROOT for app services (card 123,
// decisions/42-storybook.md).
//
// Both UI surfaces read their ports back through a module singleton —
// `sidePanelServices()` / `optionsServices()` — that a composition root fills
// once (src/sidepanel/main.ts, src/options/main.ts). Storybook is a third
// surface with the same obligation, so this file is that surface's root: it
// fills the singletons with the SAME per-surface fakes the component tests
// use (src/{sidepanel,options}/testing/fake-services.ts), which is decision
// 42's "one source of fake truth, no story-only mocks drifting from tests".
//
// -- Why a reset rather than a re-init ---------------------------------------
//
// `initSidePanelServices` throws on a second call, by design (it is the guard
// that a surface is wired exactly once). Under Vitest that costs nothing:
// every test FILE gets its own module graph, so every file's `beforeAll` sees
// a fresh, empty slot. Storybook is the opposite — ONE module graph for the
// whole session, shared by every story of every component — so "init per
// story" is not available, and a single init for the session would let story
// A's canned data leak into story B (the fakes are plain mutable objects; the
// testing modules' documented way to drive a scenario is to REASSIGN a method
// on one).
//
// So the singleton is initialised once, lazily, and `resetSidePanelStory-
// Services()` refills it in place from a freshly built bundle before each
// story renders. `Object.assign` over the SAME object is what makes this work:
// the identity `sidePanelServices()` hands out never changes (modules that
// captured it keep working), while every port behind it is new. That is the
// per-story isolation Vitest gets for free from file isolation.
//
// Nothing here forks the fakes — `createFake*Services` and `initFake*Services`
// are imported verbatim. A story that needs richer canned data passes a `seed`
// that reassigns port methods on the bundle it is handed, exactly as a test
// does (see either testing module's USAGE block).

import type { SidePanelServices } from "../src/sidepanel/app-services";
import {
  createFakeSidePanelServices,
  initFakeSidePanelServices,
} from "../src/sidepanel/testing/fake-services";
import type { OptionsServices } from "../src/options/app-services";
import {
  createFakeOptionsServices,
  initFakeOptionsServices,
} from "../src/options/testing/fake-services";

/** How a story asks for services: a callback handed the freshly reset bundle to seed. */
export type SidePanelServicesSeed = (services: SidePanelServices) => void;
export type OptionsServicesSeed = (services: OptionsServices) => void;

let sidePanel: SidePanelServices | undefined;
let options: OptionsServices | undefined;

/**
 * The side panel's singleton, filled with fakes on first call and REFILLED in
 * place on every later one. Returns the same object every time — see the
 * header for why that identity has to be stable.
 */
export function resetSidePanelStoryServices(): SidePanelServices {
  if (sidePanel === undefined) {
    sidePanel = initFakeSidePanelServices(createFakeSidePanelServices());
    return sidePanel;
  }
  return Object.assign(sidePanel, createFakeSidePanelServices());
}

/** The options page's singleton, on the same terms. */
export function resetOptionsStoryServices(): OptionsServices {
  if (options === undefined) {
    options = initFakeOptionsServices(createFakeOptionsServices());
    return options;
  }
  return Object.assign(options, createFakeOptionsServices());
}

/**
 * Fill both singletons before any story MODULE is imported.
 *
 * Storybook loads ./preview.ts (which calls this at module scope) before it
 * imports a single story file, and that ordering is load-bearing: a component
 * — or a store it imports — that reads `sidePanelServices()` while its module
 * is being evaluated would throw "services are not initialised" during the
 * import, long before any decorator could run. The per-story decorator's
 * reset still happens; this only guarantees the slot is never empty.
 */
export function initStoryServices(): void {
  resetSidePanelStoryServices();
  resetOptionsStoryServices();
}
