// The side panel's NOTICE CHANNEL (card 95,
// decisions/34-errors-as-values.md).
//
// Cards 92-94 turned every storage, provider and MCP failure into a value.
// That left the panel with a handful of `console.warn`s standing in for
// "somewhere the user can see this" — a placeholder each of those sites named
// card 95 in a comment. This module is that somewhere.
//
// WHY A STORE AND NOT LOCAL COMPONENT STATE. Two of the failures a user needs
// told about are raised from a STORE, not a component: `selectModel` (this
// folder's selection.svelte.ts) persists the model choice, and App.svelte's
// new-chat/rename handlers persist through `ChatService`. A store cannot reach
// into a component's `$state`, and duplicating the wiring into each caller
// would put the panel back to having several ad-hoc error surfaces. One
// channel, one renderer (App.svelte's transcript notices), any number of
// reporters.
//
// WHAT DOES *NOT* BELONG HERE. A view that failed to load its own data says so
// IN ITSELF — HistoryPanel's list, the picker's per-provider groups — because
// the message belongs next to the thing that is missing, and because the
// notices render in the CHAT view, which is not where that user is looking.
// This channel is for a failure whose consequence follows the user out of the
// view they caused it in.
//
// Deliberately tiny: no severities, no timeouts, no queue limit. A notice is
// dismissed by the person reading it, or replaced by the next attempt at the
// same action (see the de-duplication below).

/** One thing the panel needs to tell the user about, in the order it happened. */
export interface PanelNotice {
  id: string;
  /** A complete sentence — see src/ui/storageMessage.ts's `storageFailureMessage`, which is what builds every one of these today. */
  message: string;
}

let notices = $state<PanelNotice[]>([]);

let nextId = 0;

/** What the UI reads. Same getter-object pattern as ./panel.svelte.ts — a component reads `panelNotices.all` and Svelte tracks the rune without this module exporting a mutable binding. */
export const panelNotices = {
  get all(): PanelNotice[] {
    return notices;
  },
};

/**
 * Show `message`. An identical message already on screen is NOT stacked a
 * second time: retrying a failing action (picking the model again, renaming
 * again) is the common case, and three copies of one sentence reads as three
 * different problems.
 */
export function reportNotice(message: string): void {
  if (notices.some((n) => n.message === message)) return;
  nextId += 1;
  notices = [...notices, { id: `notice-${nextId}`, message }];
}

/** Dismiss one notice — the card's close button. */
export function dismissNotice(id: string): void {
  notices = notices.filter((n) => n.id !== id);
}

/** Drop every notice. For a test's teardown, and for a caller that has just made the whole batch irrelevant. */
export function clearNotices(): void {
  notices = [];
}
