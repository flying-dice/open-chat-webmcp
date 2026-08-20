/**
 * Folds the flat transcript (`PanelMessage[]`, which IS the persisted
 * `ChatSession.messages` array — see panel.svelte.ts's module doc comment)
 * into display groups: a user turn, an assistant prose turn, or a run of
 * consecutive tool-call steps (an "activity group"). Card 61,
 * decisions/26-transcript-activity-groups-and-turn-phase.md.
 *
 * PURE, and must never mutate its input. Every loop iteration of the agent
 * loop (src/sidepanel/services/agentLoop.ts's `runLoop`) pushes an assistant
 * message with `content: ""` purely to carry that round's `toolCalls` — the
 * next provider request needs it. This function drops that carrier FROM
 * DISPLAY ONLY; it stays exactly where it is in `ChatSession.messages`,
 * which `runLoop` replays to the provider on the next round. Nothing here
 * may rewrite, reorder, or filter that underlying array — only derive a
 * different view over it, once, per render.
 *
 * Grouping rule (one pass, one mutable "open" activity group):
 *   - `role: "user"` closes any open activity group and starts a `user` group.
 *   - `role: "assistant"` with non-empty content closes any open activity
 *     group and starts a `prose` group.
 *   - `role: "assistant"` with EMPTY content (a toolCalls-only carrier) is
 *     dropped from display and does NOT close an open activity group. This
 *     is what makes several tool rounds of one turn read as a single
 *     timeline instead of a timeline broken up by bare, empty assistant
 *     turns. If the model narrates BETWEEN rounds (a non-empty assistant
 *     message), that prose message DOES close the group — honestly, since
 *     the model said something a reader should see in order.
 *   - `role: "tool"` appends to the open activity group, creating one first
 *     if none is open.
 */
import type { PanelMessage } from "../stores/panel.svelte";

export type TranscriptGroup =
  | { kind: "user"; key: string; message: PanelMessage }
  | { kind: "prose"; key: string; message: PanelMessage }
  | { kind: "activity"; key: string; steps: PanelMessage[] };

export function groupTranscript(messages: readonly PanelMessage[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  let open: Extract<TranscriptGroup, { kind: "activity" }> | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      open = undefined;
      groups.push({ kind: "user", key: message.id, message });
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.trim() === "") {
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
      // expand/collapse toggle mid-turn (see ActivityGroup.svelte).
      open = { kind: "activity", key: `act:${message.id}`, steps: [] };
      groups.push(open);
    }
    open.steps.push(message);
  }

  return groups;
}

/**
 * Summary facts about one activity group's steps, for the group's collapsed
 * row (ActivityGroup.svelte) and the live indicator's needsAttention check.
 * Every field is a plain fact — a count, a name, a server name — never an
 * invented verb describing what the tools did (decisions/26: "no verb
 * dictionary").
 */
export interface ActivitySummary {
  /** e.g. "3 tool calls" / "1 tool call" — always a count, never a summary of what happened. */
  countLabel: string;
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

export function summariseActivity(steps: readonly PanelMessage[]): ActivitySummary {
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
    countLabel: `${steps.length} tool ${steps.length === 1 ? "call" : "calls"}`,
    namesLabel,
    serverNames: [...serverNameSet],
    errorCount,
    deniedCount,
    approvedCount,
    needsAttention: errorCount > 0 || deniedCount > 0,
  };
}
