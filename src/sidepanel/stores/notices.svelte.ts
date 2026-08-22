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
  /**
   * Stable identity for a notice a LATER event needs to retract on its own
   * (card 106's "this conversation isn't being saved", retracted once a save
   * next succeeds) — text-based de-duplication doesn't fit that: the
   * retracting event is a SUCCESS, not another identical failure to collapse
   * against, and the failing writes in between may not even share the exact
   * same `StorageErrorKind`/wording. Omitted for a notice nothing will ever
   * proactively clear; see {@link reportNotice} and {@link clearNoticeByKey}.
   */
  key?: string;
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
 *
 * `key`, when given, de-duplicates by IDENTITY instead of by text — a run of
 * failing debounced writes for the SAME reason still collapses to one
 * notice, but so does a run whose wording changed between attempts (a quota
 * failure, then an unexpected one), which plain text equality would have
 * shown as two. The existing notice's text is updated in place rather than
 * re-added, so it neither moves position nor gets a fresh id a caller might
 * be holding (see {@link clearNoticeByKey}).
 */
export function reportNotice(message: string, key?: string): void {
  if (key !== undefined) {
    const existing = notices.find((n) => n.key === key);
    if (existing) {
      if (existing.message !== message) {
        notices = notices.map((n) => (n.key === key ? { ...n, message } : n));
      }
      return;
    }
  } else if (notices.some((n) => n.message === message)) {
    return;
  }
  nextId += 1;
  // `exactOptionalPropertyTypes`: an optional field must be OMITTED, not set
  // to `undefined`, so the no-key case spreads nothing rather than `{ key:
  // undefined }`.
  notices = [
    ...notices,
    { id: `notice-${nextId}`, message, ...(key !== undefined ? { key } : {}) },
  ];
}

/** Dismiss one notice — the card's close button. */
export function dismissNotice(id: string): void {
  notices = notices.filter((n) => n.id !== id);
}

/** Retract the notice reported under `key`, if any is still up — the auto-clear half of card 106: a later event (a save succeeding again) says the earlier failure no longer applies, without waiting for the person to dismiss it themselves. A no-op if nothing is up under that key, including when the person already dismissed it. */
export function clearNoticeByKey(key: string): void {
  notices = notices.filter((n) => n.key !== key);
}

/** Drop every notice. For a test's teardown, and for a caller that has just made the whole batch irrelevant. */
export function clearNotices(): void {
  notices = [];
}
