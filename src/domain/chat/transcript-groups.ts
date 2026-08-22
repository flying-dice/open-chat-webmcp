/**
 * Folds the flat transcript (`TranscriptEntry[]`, which IS the persisted
 * `ChatSession.messages` array) into DISPLAY GROUPS: a user turn, an
 * assistant prose turn, or a run of consecutive tool-call steps (an "activity
 * group"). Card 61, decisions/26-transcript-activity-groups-and-turn-phase.md.
 *
 * Card 77 moved this out of src/sidepanel/lib/transcriptGroups.ts. It was
 * already pure; what it could not do from there was type itself against the
 * persisted shape — it imported the panel store's `PanelMessage`, so the rule
 * for reading a transcript depended on the store that displayed one. It now
 * takes `TranscriptEntry` from this context and the store depends on it
 * instead.
 *
 * PURE, and must never mutate its input. Every iteration of the agent turn
 * (./turn.ts's `runLoop`) pushes an assistant entry with `content: ""` purely
 * to carry that round's `toolCalls` — the next provider request needs it.
 * This function drops that carrier FROM DISPLAY ONLY; it stays exactly where
 * it is in `ChatSession.messages`, which the loop replays on the next round.
 * Nothing here may rewrite, reorder or filter that underlying array — only
 * derive a different view over it, once, per render.
 *
 * Grouping rule (one pass, one mutable "open" activity group):
 *   - `role: "user"` closes any open activity group and starts a `user` group.
 *   - `role: "assistant"` with non-empty content closes any open activity
 *     group and starts a `prose` group.
 *   - `role: "assistant"` with EMPTY content AND NO `note` (a toolCalls-only
 *     carrier) is dropped from display and does NOT close an open activity
 *     group. The `note` exemption is card 114's: since decisions/38 a note
 *     entry stores a KIND and no words at all, so emptiness alone no longer
 *     means "nothing to show" — it means the words are the renderer's to
 *     supply. This is
 *     what makes several tool rounds of one turn read as a single timeline
 *     instead of a timeline broken up by bare, empty assistant turns. If the
 *     model narrates BETWEEN rounds (a non-empty assistant message), that
 *     prose message DOES close the group — honestly, since the model said
 *     something a reader should see in order.
 *   - `role: "tool"` appends to the open activity group, creating one first
 *     if none is open.
 */

import type { TranscriptEntry } from "./message";

export type TranscriptGroup =
  | { kind: "user"; key: string; message: TranscriptEntry }
  | { kind: "prose"; key: string; message: TranscriptEntry }
  | { kind: "activity"; key: string; steps: TranscriptEntry[] };

export function groupTranscript(messages: readonly TranscriptEntry[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  let open: Extract<TranscriptGroup, { kind: "activity" }> | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      open = undefined;
      groups.push({ kind: "user", key: message.id, message });
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.trim() === "" && !message.note) {
        // A toolCalls-only carrier — drop from display, but deliberately do
        // NOT clear `open`: see the module doc comment.
        continue;
      }
      open = undefined;
      groups.push({ kind: "prose", key: message.id, message });
      continue;
    }

    // role: "tool"
    if (!open) {
      // The group's key is fixed to the FIRST step's id and must never be
      // recomputed from `steps.length` or a joined id list as more steps
      // append — doing so would change the key on every new tool row,
      // remounting the group and silently resetting the user's
      // expand/collapse toggle mid-turn.
      open = { kind: "activity", key: `act:${message.id}`, steps: [] };
      groups.push(open);
    }
    open.steps.push(message);
  }

  return groups;
}

/**
 * Summary facts about one activity group's steps, for the group's collapsed
 * row and the live indicator's needsAttention check. Every field is a plain
 * fact — a count, a name, a server name — never an invented verb describing
 * what the tools did (decisions/26: "no verb dictionary").
 */
export interface ActivitySummary {
  /**
   * The number of steps in this group — always a count, never a summary of
   * what happened. Card 101 moved the pluralised wording ("3 tool calls" /
   * "1 tool call") UI-side (src/sidepanel/components/ActivityGroup.svelte,
   * via a Paraglide plural message): the domain layer cannot pluralise
   * per-locale, so it has no business producing the sentence, only the fact.
   */
  stepCount: number;
  /** Up to 2 distinct tool names, joined, then "+N" for the rest; "" if there are no steps. */
  namesLabel: string;
  /** Distinct server display names touched by any step in this group (decisions/19 §6 — a collapsed group must never hide that a remote server was called). */
  serverNames: string[];
  errorCount: number;
  deniedCount: number;
  approvedCount: number;
  /** `errorCount > 0 || deniedCount > 0` — a group with either never auto-collapses. */
  needsAttention: boolean;
}

export function summariseActivity(steps: readonly TranscriptEntry[]): ActivitySummary {
  const distinctNames: string[] = [];
  const serverNameSet = new Set<string>();
  let errorCount = 0;
  let deniedCount = 0;
  let approvedCount = 0;

  for (const step of steps) {
    if (step.toolName && !distinctNames.includes(step.toolName)) distinctNames.push(step.toolName);
    if (step.toolOrigin?.kind === "server") serverNameSet.add(step.toolOrigin.serverName);
    if (step.toolStatus === "error") errorCount++;
    if (step.toolStatus === "denied") deniedCount++;
    if (step.toolMode === "approved") approvedCount++;
  }

  const namesLabel =
    distinctNames.length === 0
      ? ""
      : distinctNames.length <= 2
        ? distinctNames.join(", ")
        : `${distinctNames.slice(0, 2).join(", ")} +${distinctNames.length - 2}`;

  return {
    stepCount: steps.length,
    namesLabel,
    serverNames: [...serverNameSet],
    errorCount,
    deniedCount,
    approvedCount,
    needsAttention: errorCount > 0 || deniedCount > 0,
  };
}
