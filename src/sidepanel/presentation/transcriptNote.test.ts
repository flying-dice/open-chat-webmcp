// Card 114 (decisions/38-transcript-stores-codes-not-prose.md): the
// code-to-copy half of the transcript. These cases exist because this module
// is the ONLY thing standing between a stored kind and an empty bubble — a
// kind added to the domain union without an arm here is a note that renders
// as nothing, and TypeScript's exhaustiveness check is the only other guard.
import { describe, expect, it } from "vitest";
import type { NoteAction, TranscriptNote } from "../../domain/chat";
import { isolateLtr } from "../../ui/bidi";
import { noteActionLabel, noteText } from "./transcriptNote";
import { m } from "../../paraglide/messages.js";

const KINDS: TranscriptNote[] = [
  { kind: "provider-error", error: { kind: "auth", status: 401, message: "bad key" } },
  { kind: "iteration-cap", limit: 8 },
  { kind: "no-provider" },
  { kind: "no-selection" },
  { kind: "tool-denied" },
  { kind: "tool-unknown", toolName: "made_up" },
  { kind: "tool-timeout", seconds: 0.05 },
  { kind: "tool-stopped-before" },
  { kind: "tool-stopped" },
  { kind: "tool-failed" },
];

describe("noteText", () => {
  it.each(KINDS)("words %o as something a person can read", (note) => {
    expect(noteText(note).trim().length).toBeGreaterThan(0);
  });

  it("renders the params, not just the kind", () => {
    expect(noteText({ kind: "iteration-cap", limit: 3 })).toContain(
      m.note_iterationCap({ limit: 3 }),
    );
    expect(noteText({ kind: "tool-unknown", toolName: "made_up" })).toContain("made_up");
    expect(noteText({ kind: "tool-timeout", seconds: 0.05 })).toContain("0.05");
  });

  it("rebuilds a copyable fix as a fenced code block, from the error's own params", () => {
    // Card 14's copy button comes from the Markdown code-block renderer, so
    // the fence has to be built here rather than stored — and the command
    // must survive verbatim, since a copy button only helps if what it copies
    // is exactly what the user needs to run.
    const text = noteText({
      kind: "provider-error",
      error: {
        kind: "unreachable-or-cors",
        message: "Could not reach the server.",
        fix: { label: "Restart Ollama with", command: "OLLAMA_ORIGINS=* ollama serve" },
      },
    });
    expect(text).toContain("```\nOLLAMA_ORIGINS=* ollama serve\n```");
  });

  it("leaves a fix-less unreachable error as a single line, with no empty fence", () => {
    const text = noteText({
      kind: "provider-error",
      error: { kind: "unreachable-or-cors", message: "Could not reach the server." },
    });
    expect(text).not.toContain("```");
  });
});

describe("noteText — bidi", () => {
  it("isolates a tool name as LTR, since it is an identifier dropped into a sentence that may run right-to-left", () => {
    // Card 104's rule (src/ui/bidi.ts): without the isolate the quotes around
    // the name land on the wrong sides inside an Arabic sentence, and there
    // is no element boundary here to hang `dir="ltr"` on.
    expect(noteText({ kind: "tool-unknown", toolName: "made_up" })).toContain(
      isolateLtr("made_up"),
    );
  });
});

describe("noteActionLabel", () => {
  it("labels a chip from its reason", () => {
    expect(noteActionLabel({ kind: "retry" })).toBe(m.retryAction());
    expect(noteActionLabel({ kind: "open-options", reason: "check-api-key" })).toBe(
      m.openOptionsCheckApiKeyAction(),
    );
    expect(noteActionLabel({ kind: "open-options", reason: "add-provider" })).toBe(
      m.openOptionsAddProviderAction(),
    );
  });

  it("LEGACY PASSTHROUGH: a chip stored with a label and no reason keeps its own words", () => {
    // Pre-release: nothing is migrated. The old English label was persisted,
    // and it renders as recorded rather than being guessed at.
    const legacy: NoteAction = { kind: "open-options", label: "Open options to check the API key" };
    expect(noteActionLabel(legacy)).toBe("Open options to check the API key");
  });

  it("falls back to the generic action rather than an empty button when neither is stored", () => {
    expect(noteActionLabel({ kind: "open-options" })).toBe(m.openOptionsAction());
  });
});
