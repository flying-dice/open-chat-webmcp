// Card 115: the sentence a turn in flight speaks, and — as much to the point —
// which phases speak at all.
//
// Both facts have two consumers now (ActivityIndicator.svelte draws it,
// App.svelte's live region announces it), and the whole reason they were
// pulled into one module is that a screen reader saying something different
// from what is on screen is a bug no screenshot can show. These cases pin the
// pairing so a fourth phase, or a reworded sentence, cannot drift one reader
// away from the other.
import { describe, expect, it } from "vitest";
import type { TurnPhase } from "../../domain/chat";
import { isSpokenPhase, turnStatusSentence } from "./turnStatus";
import { m } from "../../paraglide/messages.js";

const PHASES: TurnPhase[] = [
  { kind: "waiting" },
  { kind: "streaming" },
  { kind: "awaiting-approval", toolName: "add-note" },
  { kind: "calling", toolName: "add-note", startedAt: 0 },
];

describe("isSpokenPhase", () => {
  it("speaks for waiting and calling only", () => {
    expect(PHASES.filter(isSpokenPhase).map((p) => p.kind)).toEqual(["waiting", "calling"]);
  });

  it("stays silent for streaming (the arriving text is its own feedback)", () => {
    expect(isSpokenPhase({ kind: "streaming" })).toBe(false);
  });

  it("stays silent while awaiting approval (ApprovalCard moves focus into itself instead)", () => {
    expect(isSpokenPhase({ kind: "awaiting-approval", toolName: "add-note" })).toBe(false);
  });
});

describe("turnStatusSentence", () => {
  it("names the model being waited on", () => {
    expect(turnStatusSentence({ kind: "waiting" }, "llama3.1")).toContain("llama3.1");
  });

  it("falls back to a generic subject when nothing is resolved yet", () => {
    expect(turnStatusSentence({ kind: "waiting" }, undefined)).toBe(
      m.activityIndicator_waitingFor({ model: m.activityIndicator_waitingForModelFallback() }),
    );
  });

  it("names the tool, and the server it runs on when there is one", () => {
    const local = turnStatusSentence(
      { kind: "calling", toolName: "add-note", startedAt: 0 },
      "llama3.1",
    );
    expect(local).toContain("add-note");

    const remote = turnStatusSentence(
      {
        kind: "calling",
        toolName: "docs__search",
        origin: { kind: "server", serverId: "s1", serverName: "Docs Server" },
        startedAt: 0,
      },
      "llama3.1",
    );
    expect(remote).toContain("docs__search");
    expect(remote).toContain("Docs Server");
  });

  it("never invents a verb for what the tool is doing (decisions/26)", () => {
    // The one rule this module inherits from card 61: the sentence reports a
    // name and a place, never "Reading the page…" or "Thinking…".
    const sentence = turnStatusSentence(
      { kind: "calling", toolName: "read-page-state", startedAt: 0 },
      "llama3.1",
    );
    expect(sentence.toLowerCase()).not.toContain("think");
  });
});
