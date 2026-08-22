// WORDS for a `TurnPhase` — card 115's accessibility pass.
//
// The sentence itself is not new: ActivityIndicator.svelte has composed it
// since card 61 (decisions/26 — "no verb dictionary": the tool's name and
// where it runs, never "Reading the page…"). What card 115 needed was a
// SECOND reader for exactly the same sentence: the panel's one polite live
// region (src/sidepanel/App.svelte), which announces what a sighted user
// reads off the tail indicator.
//
// Two readers, one composition, for the reason ./transcriptNote.ts states for
// notes: the visible line and the announced line drifting apart is a bug
// nobody would ever see in a screenshot.
//
// WHICH PHASES SPEAK, and why the other two are silent — the same rule
// Transcript.svelte's `tailPhase` already applied to the tail indicator, now
// stated once here rather than re-derived per consumer:
//
//   waiting/calling      → a sentence. Nothing else on screen says what is
//                          happening; a screen-reader user gets silence
//                          otherwise.
//   streaming            → silent. The reply itself is the feedback, and an
//                          announcement per token (or per phase re-entry
//                          after each tool round) is exactly the live-region
//                          spam card 115 was written to avoid.
//   awaiting-approval    → silent. ApprovalCard.svelte moves FOCUS into the
//                          card as it mounts, which announces the card, its
//                          group label and the focused button. A live region
//                          on top of that would say the same thing twice.

import type { TurnPhase } from "../../domain/chat";
import { isolateLtr } from "../../ui/bidi";
import { originLabel } from "./toolOrigin";
import { m } from "../../paraglide/messages.js";

/** The two phases that have something to say — see the header for the other two. */
export type SpokenPhase = Extract<TurnPhase, { kind: "waiting" } | { kind: "calling" }>;

/** Narrows a live turn phase to one that produces a sentence. */
export function isSpokenPhase(phase: TurnPhase): phase is SpokenPhase {
  return phase.kind === "waiting" || phase.kind === "calling";
}

/**
 * The one line describing a turn in flight, read by the tail indicator and
 * announced by the panel's live region.
 *
 * `tool`/`origin`/`model` are identifiers interpolated into a translated
 * sentence with no element boundary around just that part, so they are
 * Unicode-isolated rather than `dir="ltr"` (card 104's RTL bidi-isolation
 * pass) — the isolation travels with the string, which is what makes it
 * correct in a live region too, where there is no element at all.
 */
export function turnStatusSentence(phase: SpokenPhase, modelLabel: string | undefined): string {
  if (phase.kind === "waiting") {
    return m.activityIndicator_waitingFor({
      model: modelLabel ? isolateLtr(modelLabel) : m.activityIndicator_waitingForModelFallback(),
    });
  }
  return phase.origin
    ? m.activityIndicator_callingOn({
        tool: isolateLtr(phase.toolName),
        origin: isolateLtr(originLabel(phase.origin)),
      })
    : m.activityIndicator_calling({ tool: isolateLtr(phase.toolName) });
}
