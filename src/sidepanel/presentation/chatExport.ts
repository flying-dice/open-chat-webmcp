// The UI half of card 116's chat export — everything that needs a LOCALE
// (role labels, section headings, a note's rendered sentence, a formatted
// timestamp, a tool's origin label) is resolved HERE, then handed to the
// pure domain serializer (src/domain/chat/export.ts), which owns only the
// document's structure. See that module's header for why the seam is drawn
// exactly here rather than deeper.
//
// Every value this file resolves comes from a function the transcript
// itself already renders through — `noteText`/`originLabel`/
// `formatDateTime`, the same imports Transcript.svelte, ToolCallRow.svelte
// and CallLogEntry.svelte use — so the exported Markdown says exactly what
// the panel showed, in whichever language it showed it.

import type { TranscriptEntry } from "../../domain/chat";
import { chatExportFilename, serializeChatMarkdown, type ChatExportEntry } from "../../domain/chat";
import { formatDateTime } from "../../ui/datetime";
import { noteText } from "./transcriptNote";
import { originLabel } from "./toolOrigin";
import { m } from "../../paraglide/messages.js";

/**
 * The same "what does this entry say" resolution ToolCallRow.svelte's
 * `outcomeText` and Transcript.svelte's transcript body already apply: a
 * note (card 114) renders through `noteText`, in the reader's current
 * language; anything else renders as its own stored content, unchanged
 * (including the pre-card-114 legacy passthrough — old prose renders
 * verbatim there too, and does here for the same reason).
 */
function entryBody(entry: TranscriptEntry): string {
  return entry.note ? noteText(entry.note) : entry.content;
}

function toExportEntry(entry: TranscriptEntry): ChatExportEntry {
  const timestamp = formatDateTime(entry.createdAt);
  const body = entryBody(entry);
  if (entry.role !== "tool") {
    return { kind: "message", role: entry.role, timestamp, body };
  }
  return {
    kind: "tool",
    timestamp,
    name: entry.toolName ?? "",
    origin: entry.toolOrigin ? originLabel(entry.toolOrigin) : m.toolCallRow_originUnknownBadge(),
    // A note is always a failure kind (card 114's tool-* vocabulary); the
    // legacy passthrough has no note, so it falls back to `toolStatus` —
    // the same judgment ToolCallRow.svelte's own `resultIsError` makes.
    failed:
      entry.note !== undefined || entry.toolStatus === "error" || entry.toolStatus === "denied",
    args: entry.toolArgs ?? {},
    body,
  };
}

/**
 * The active chat's messages, rendered as one Markdown document — clipboard
 * text and file content are the exact same string (OverflowMenu.svelte
 * hands this to both `copyText` and `downloadTextFile`).
 */
export function buildChatExportMarkdown(
  entries: readonly TranscriptEntry[],
  title: string,
  origin: string,
): string {
  return serializeChatMarkdown(
    { title, origin, exportedAt: formatDateTime(Date.now()) },
    entries.map(toExportEntry),
    {
      you: m.chatExport_youLabel(),
      assistant: m.chatExport_assistantLabel(),
      arguments: m.argumentsHeading(),
      result: m.resultHeading(),
      error: m.errorHeading(),
      origin: m.chatExport_originLabel(),
      exported: m.chatExport_exportedLabel(),
    },
  );
}

/** A `.md` filename for `title`, falling back to the same "untitled" wording every other chat-title call site uses (title.ts's `untitled` pattern). */
export function chatExportFilenameFor(title: string): string {
  return chatExportFilename(title, m.chatTitle_untitled());
}
