// WORDS for a `TranscriptNote` — the display half of card 114
// (decisions/38-transcript-stores-codes-not-prose.md), and the same shape
// ./sharedContext.ts, ./connectionStatus.ts and ./toolOrigin.ts already use
// for a code the domain hands over with no prose attached.
//
// THE SPLIT THIS FILE COMPLETES. The turn engine (src/domain/chat/turn.ts)
// used to compose "⚠️ Stopped after 8 tool-call rounds…" and "The user denied
// this tool call." straight into `TranscriptEntry.content`, where they were
// PERSISTED: a chat recorded once read in that language forever, in every
// locale, and a copywriter could never improve shipped history. The entry now
// stores a KIND plus its params and these two functions are where it becomes
// a sentence — so switching the panel to Japanese retroactively localizes the
// whole transcript, which is exactly what a reader expects.
//
// Card 119 introduced this pattern for `SharedContextMarker` and said its
// `sharedContextLabel` was the shape card 114's renderer should take. It is:
// one exhaustive switch, no branching on anything but the kind, no state.
//
// MARKDOWN, NOT PLAIN TEXT. `noteText` returns markdown because a note is
// rendered through the transcript's existing `Markdown` component, and card
// 14's copyable fix (Ollama's exact `OLLAMA_ORIGINS` command) has to arrive
// as a fenced code block so it gets the existing code-block "Copy" button
// rather than a second copy-button implementation. Nothing else here uses
// markup — the other kinds are one sentence each.
//
// THE ONE ENGLISH RESIDUE, named so nobody mistakes it for an oversight: a
// `"provider-error"` note carries the whole `ProviderError`, and two of that
// type's arms (`unreachable-or-cors`, `not-supported`) pass an infra client's
// own message through verbatim, as does the `fix.label`/`fix.command` pair.
// That text originates in src/infra/ollama or src/infra/openai — not in the
// domain — and localizing infra-authored wire prose is pre-existing debt this
// card did not widen (see src/ui/providerMessage.ts's header, which states
// the same boundary). Everything the DOMAIN would have said is a kind.

import type { NoteAction, TranscriptNote } from "../../domain/chat";
import { isolateLtr } from "../../ui/bidi";
import { describeProviderError } from "../../ui/providerMessage";
import { m } from "../../paraglide/messages.js";

/**
 * What a persisted note says in the reader's own language, as markdown.
 *
 * The `⚠️` prefix on the two failure notes is punctuation, not copy: it is
 * the same glyph in every locale, and it is what makes an error note scannable
 * against the model's own prose in a transcript with no bubble around either.
 */
export function noteText(note: TranscriptNote): string {
  switch (note.kind) {
    case "provider-error": {
      const base = `⚠️ ${describeProviderError(note.error)}`;
      // Only an unreachable-or-CORS failure ever carries a fix, and only some
      // of those do (OpenAI's answer is a host permission, a UI action with
      // no command to run). Rendered verbatim in a fence — a copy button only
      // helps if what it copies is exactly what the user needs to run.
      if (note.error.kind === "unreachable-or-cors" && note.error.fix) {
        return `${base}\n\n${note.error.fix.label}:\n\n\`\`\`\n${note.error.fix.command}\n\`\`\``;
      }
      return base;
    }
    case "iteration-cap":
      return `⚠️ ${m.note_iterationCap({ limit: note.limit })}`;
    case "no-provider":
      return m.app_noProviderNote();
    case "no-selection":
      return m.app_noSelectionNote();
    case "tool-denied":
      return m.toolOutcome_denied();
    case "tool-unknown":
      // Card 104's bidi rule: a tool name is a left-to-right identifier
      // interpolated into a sentence that may be right-to-left, and there is
      // no element boundary here to hang `dir="ltr"` on — so it gets an LTR
      // isolate. Without it, the quotes around the name land on the wrong
      // sides inside the Arabic sentence.
      return m.toolOutcome_unknownTool({ name: isolateLtr(note.toolName) });
    case "tool-timeout":
      return m.toolOutcome_timedOut({ seconds: note.seconds });
    case "tool-stopped-before":
      return m.toolOutcome_stoppedBefore();
    case "tool-stopped":
      return m.toolOutcome_stopped();
    case "tool-failed":
      return m.toolOutcome_failed();
  }
}

/**
 * The label on a note's action chip.
 *
 * THE LEGACY PASSTHROUGH LIVES HERE (card 114, pre-release rules — nothing is
 * converted and nothing is migrated). A chip written before this card stored
 * its own English `label` and no `reason`; that stored string is rendered
 * exactly as it was recorded, which is decisions/38's stated posture for old
 * chats — they keep their embedded English until they are deleted or evicted.
 * A chip written since carries only a `reason`, and takes today's copy in
 * today's language.
 */
export function noteActionLabel(action: NoteAction): string {
  if (action.kind === "retry") return m.retryAction();
  switch (action.reason) {
    case "check-api-key":
      return m.openOptionsCheckApiKeyAction();
    case "add-provider":
      return m.openOptionsAddProviderAction();
    default:
      // Legacy: `reason` is absent, so the note is one this build did not
      // write. `label` is absent too only on data that was never valid in
      // either shape — fall back to the generic action rather than an empty
      // button.
      return action.label ?? m.openOptionsAction();
  }
}
