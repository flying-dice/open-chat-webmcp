// Chat export — turning a stored conversation into a portable Markdown
// document (card 116).
//
// THE SEAM, judged and journalled here rather than guessed at from the
// card's own wording. Decisions/29 forbids this module from importing
// paraglide, Svelte or the UI layer at all, so "the serializer maps a
// note's kind through the UI's existing label functions" cannot literally
// mean this file calls `noteText()` — that function lives in
// src/sidepanel/presentation/transcriptNote.ts and reads `m.*()`. What it
// DOES mean, and what this module implements, is the same seam ./title.ts
// already drew for its `untitled` parameter (card 102): every word that
// depends on a locale — role labels, section headings, a resolved note
// sentence, a formatted timestamp, a tool's origin label — is resolved by
// the CALLER (src/sidepanel/presentation/chatExport.ts, which imports
// `noteText`/`originLabel`/`formatDateTime`/`m.*` exactly the same way
// Transcript.svelte and ToolCallRow.svelte already do) before a single
// `ChatExportEntry` is built. What is left for this module to own is the
// STRUCTURE of the document: heading order, which entries are worth a
// section at all, how a tool call's args/result become fenced blocks, and
// filename sanitisation. That is genuinely a rule about how a CHAT
// serializes, which is why it lives in this bounded context rather than in
// the UI layer alongside the words — and it is exactly the kind of thing a
// unit test can pin with plain string fixtures, no paraglide involved.
//
// ONE DELIBERATE SCOPE CUT: `TranscriptEntry.sharedContext` (card 119, page
// context markers) is not rendered here. The export is a record of what was
// SAID, and a marker recording that a turn also carried page text is a
// smaller fact that can follow in a later card if anyone asks for it — left
// out rather than guessed at.
//
// Pure: no chrome.*, no fetch, no DOM, no Svelte, no locale.

/** One line of a chat, already resolved to plain text by the caller — see this module's header for why. */
export type ChatExportEntry =
  | {
      kind: "message";
      role: "user" | "assistant";
      /** Preformatted via src/ui/datetime.ts — this module doesn't know what a locale is. */
      timestamp: string;
      /**
       * The entry's own words: raw transcript content, or a note already
       * rendered through `noteText` — the same source the transcript itself
       * reads, so the export says exactly what the panel showed. `""` is
       * skipped entirely by {@link serializeChatMarkdown} rather than
       * rendered as an empty section — an assistant turn that only
       * requested tool calls has nothing of its own to say.
       */
      body: string;
    }
  | {
      kind: "tool";
      timestamp: string;
      name: string;
      /** Preformatted via src/sidepanel/presentation/toolOrigin.ts, or the "unknown origin" label — always a string, never left for this module to guess a fallback. */
      origin: string;
      /**
       * Whether `body` below is the call's own result or a failure this
       * extension decided (denied, timed out, stopped, an unknown name) or
       * the tool's own error text — decides whether the block below renders
       * under the Result or the Error heading. Mirrors the same
       * `note ?? toolStatus` judgment ToolCallRow.svelte's `resultIsError`
       * already makes, just made once by the caller instead of twice.
       */
      failed: boolean;
      args: Record<string, unknown>;
      /** Same resolution as a message entry's `body` — the tool's own result text, or a note already rendered to a sentence. `""` for a call with no result yet. */
      body: string;
    };

/** Section headings and role labels this document needs, all already localized by the caller. */
export interface ChatExportLabels {
  you: string;
  assistant: string;
  arguments: string;
  result: string;
  error: string;
  origin: string;
  exported: string;
}

/** Chat-level facts shown once, at the top of the document. */
export interface ChatExportMeta {
  title: string;
  /** The chat's origin, verbatim — never localized, it's a URL. */
  origin: string;
  /** Preformatted via src/ui/datetime.ts. */
  exportedAt: string;
}

/**
 * Render a chat as a single Markdown document: a title, an origin/exported-at
 * header, then every entry in order as its own section. Tool calls become a
 * heading plus a fenced JSON block for their arguments and a second fenced
 * block for their result or failure — a markdown-native shape for
 * structured data that a definition list (how the panel itself renders a
 * call's payload) has no equivalent for in a plain-text file; the WORDS in
 * both places are identical, which is what "matches what the user sees"
 * actually buys here.
 */
export function serializeChatMarkdown(
  meta: ChatExportMeta,
  entries: readonly ChatExportEntry[],
  labels: ChatExportLabels,
): string {
  const header = [
    `# ${meta.title}`,
    "",
    `- ${labels.origin}: ${meta.origin}`,
    `- ${labels.exported}: ${meta.exportedAt}`,
  ].join("\n");

  const sections = entries
    .map((entry) => renderEntry(entry, labels))
    .filter((section): section is string => section !== undefined);

  if (sections.length === 0) return `${header}\n`;
  return `${header}\n\n---\n\n${sections.join("\n\n")}\n`;
}

function renderEntry(entry: ChatExportEntry, labels: ChatExportLabels): string | undefined {
  return entry.kind === "tool" ? renderToolEntry(entry, labels) : renderMessageEntry(entry, labels);
}

function renderMessageEntry(
  entry: Extract<ChatExportEntry, { kind: "message" }>,
  labels: ChatExportLabels,
): string | undefined {
  if (entry.body.trim() === "") return undefined;
  const roleLabel = entry.role === "user" ? labels.you : labels.assistant;
  return `## ${roleLabel} — ${entry.timestamp}\n\n${entry.body}`;
}

function renderToolEntry(
  entry: Extract<ChatExportEntry, { kind: "tool" }>,
  labels: ChatExportLabels,
): string {
  const parts = [
    `### \`${entry.name}\` — ${entry.origin} — ${entry.timestamp}`,
    "",
    `**${labels.arguments}**`,
    "",
    fencedBlock(JSON.stringify(entry.args, null, 2), "json"),
  ];
  if (entry.body.trim() !== "") {
    parts.push(
      "",
      `**${entry.failed ? labels.error : labels.result}**`,
      "",
      fencedBlock(entry.body),
    );
  }
  return parts.join("\n");
}

function fencedBlock(content: string, lang = ""): string {
  const fence = "```";
  return `${fence}${lang}\n${content}\n${fence}`;
}

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

/**
 * Characters no common filesystem accepts in a filename. Space and hyphen are
 * deliberately NOT in here — the whitespace-collapse step right below turns
 * any run of either into a single hyphen regardless of where it came from.
 */
const RESERVED_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** Longest filename stem this produces, before the extension — generous for a chat title, bounded so a pathological title can't produce an unusable path. */
const MAX_FILENAME_STEM_LENGTH = 80;

function toFilenameStem(text: string): string {
  return text
    .replace(RESERVED_FILENAME_CHARS, " ")
    .replace(/\s+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_FILENAME_STEM_LENGTH);
}

/**
 * A `.md` filename derived from a chat's title: unicode letters (any script —
 * a chat's title may be Japanese, Arabic, anything) are kept as-is, only the
 * characters no filesystem accepts are stripped, and whitespace collapses to
 * hyphens. `fallback` is the caller's localized text for a title that
 * sanitizes down to nothing at all (card 102's `untitled` pattern, same as
 * ./title.ts) — and if even THAT sanitizes to nothing (a pathological
 * fallback string, never expected in practice), `"chat"` is the last resort:
 * not a copy decision, just this function refusing to hand back an
 * extension with no stem.
 */
export function chatExportFilename(title: string, fallback: string): string {
  const stem = toFilenameStem(title) || toFilenameStem(fallback) || "chat";
  return `${stem}.md`;
}
