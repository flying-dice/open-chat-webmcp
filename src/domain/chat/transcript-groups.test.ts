import { describe, it, expect } from "vitest";
import { groupTranscript, summariseActivity } from "./transcript-groups";
import type { TranscriptEntry } from "./message";

function user(id: string, content = "hi"): TranscriptEntry {
  return { id, role: "user", content, createdAt: 0 };
}

function prose(id: string, content = "hello"): TranscriptEntry {
  return { id, role: "assistant", content, createdAt: 0 };
}

/** A toolCalls-only carrier: an assistant entry with EMPTY content, exactly what runLoop pushes to hold that round's toolCalls for replay. */
function carrier(id: string): TranscriptEntry {
  return { id, role: "assistant", content: "", createdAt: 0 };
}

function tool(id: string, overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id,
    role: "tool",
    content: "result",
    createdAt: 0,
    toolName: "read_page",
    toolCallId: id,
    toolStatus: "success",
    toolMode: "auto",
    ...overrides,
  };
}

describe("groupTranscript", () => {
  it("groups a plain user message on its own", () => {
    const groups = groupTranscript([user("u1")]);
    expect(groups).toEqual([{ kind: "user", key: "u1", message: expect.any(Object) }]);
  });

  it("groups a non-empty assistant message as prose", () => {
    const groups = groupTranscript([prose("a1")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe("prose");
  });

  it("folds consecutive tool-call entries into a single activity group", () => {
    const groups = groupTranscript([user("u1"), carrier("c1"), tool("t1"), tool("t2"), tool("t3")]);
    expect(groups).toHaveLength(2);
    const activity = groups[1]!;
    expect(activity.kind).toBe("activity");
    if (activity.kind === "activity") {
      expect(activity.steps.map((s) => s.id)).toEqual(["t1", "t2", "t3"]);
    }
  });

  it("drops a toolCalls-only carrier (empty-content assistant entry) from display without closing the open activity group", () => {
    const groups = groupTranscript([user("u1"), tool("t1"), carrier("c1"), tool("t2")]);
    // The carrier must not appear as its own group, and the two tool steps
    // either side of it must land in the SAME activity group.
    expect(groups.map((g) => g.kind)).toEqual(["user", "activity"]);
    const activity = groups[1]!;
    expect(activity.kind).toBe("activity");
    if (activity.kind === "activity") {
      expect(activity.steps.map((s) => s.id)).toEqual(["t1", "t2"]);
    }
  });

  it("does NOT drop an empty assistant entry that carries a note — since card 114 its words live in the renderer, not in `content`", () => {
    // Before decisions/38 a note was prose in `content`, so emptiness alone
    // was a safe proxy for "nothing to show". A note entry is empty BY
    // CONSTRUCTION now, and dropping it would erase the terminal-error and
    // iteration-cap notes from the transcript entirely — with their Retry
    // chip, which is the only way out of a failed turn.
    const note: TranscriptEntry = {
      id: "n1",
      role: "assistant",
      content: "",
      createdAt: 0,
      note: { kind: "iteration-cap", limit: 8 },
    };
    const groups = groupTranscript([user("u1"), tool("t1"), note]);
    // It also CLOSES the activity group, exactly as visible prose does: the
    // note is something a reader should see in order, after the calls.
    expect(groups.map((g) => g.kind)).toEqual(["user", "activity", "prose"]);
  });

  it("a non-empty assistant message BETWEEN tool rounds closes the open activity group and starts a new one after", () => {
    const groups = groupTranscript([
      user("u1"),
      tool("t1"),
      prose("a1", "here is what I found so far"),
      tool("t2"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["user", "activity", "prose", "activity"]);
  });

  it("a user message closes any open activity group", () => {
    const groups = groupTranscript([user("u1"), tool("t1"), user("u2")]);
    expect(groups.map((g) => g.kind)).toEqual(["user", "activity", "user"]);
  });

  it("never mutates its input array or entries", () => {
    const messages = [user("u1"), tool("t1"), tool("t2")];
    const snapshot = JSON.parse(JSON.stringify(messages));
    groupTranscript(messages);
    expect(JSON.parse(JSON.stringify(messages))).toEqual(snapshot);
  });

  it("returns an empty list for an empty transcript", () => {
    expect(groupTranscript([])).toEqual([]);
  });

  describe("activity group key stability", () => {
    it("keys an activity group off its FIRST step's id, unchanged as more steps are folded in", () => {
      const afterOneStep = groupTranscript([user("u1"), tool("t1")]);
      const afterThreeSteps = groupTranscript([user("u1"), tool("t1"), tool("t2"), tool("t3")]);
      expect(afterOneStep[1]!.key).toBe("act:t1");
      expect(afterThreeSteps[1]!.key).toBe("act:t1");
      expect(afterOneStep[1]!.key).toBe(afterThreeSteps[1]!.key);
    });

    // Card 64 (boards/project-backlog/64-transcript-duplicate-group-key-crash.md):
    // a duplicate Svelte each-block key crashed the whole side panel. The UI
    // fix (Transcript.svelte) moved to keying its {#each} on list position
    // instead of relying on group.key's uniqueness — but the domain-level
    // condition that made the old key collide is real and worth pinning down
    // here: groupTranscript derives each activity group's key ONLY from its
    // first step's message id (`act:${message.id}`), with no de-duplication
    // against any other group in the same list. If two SEPARATE activity
    // groups (folded apart by an intervening prose message) each open on a
    // step carrying the same id — which card 64's own investigation flagged
    // as a symptom of a message-id being duplicated upstream, in the
    // tab-sync/session-restore path — groupTranscript happily hands back two
    // different groups sharing one key. This test documents that the
    // function does NOT itself guard against colliding ids; it is not
    // groupTranscript's job to deduplicate ids that should never repeat.
    it("can produce two different activity groups sharing the same key when their opening step ids collide", () => {
      const duplicateId = "dup-step-id";
      const groups = groupTranscript([
        user("u1"),
        tool(duplicateId),
        prose("a1", "an update between tool rounds"),
        tool(duplicateId),
      ]);

      const activityGroups = groups.filter((g) => g.kind === "activity");
      expect(activityGroups).toHaveLength(2);
      expect(activityGroups[0]!.key).toBe(`act:${duplicateId}`);
      expect(activityGroups[1]!.key).toBe(`act:${duplicateId}`);
      expect(activityGroups[0]!.key).toBe(activityGroups[1]!.key);
    });
  });
});

describe("summariseActivity", () => {
  it("counts the steps in the group", () => {
    expect(summariseActivity([tool("t1")]).stepCount).toBe(1);
    expect(summariseActivity([tool("t1"), tool("t2")]).stepCount).toBe(2);
  });

  it("returns empty facts for no steps", () => {
    const summary = summariseActivity([]);
    expect(summary).toEqual({
      stepCount: 0,
      namesLabel: "",
      serverNames: [],
      errorCount: 0,
      deniedCount: 0,
      approvedCount: 0,
      needsAttention: false,
    });
  });

  it("lists up to 2 distinct tool names verbatim", () => {
    const steps = [tool("t1", { toolName: "read" }), tool("t2", { toolName: "write" })];
    expect(summariseActivity(steps).namesLabel).toBe("read, write");
  });

  it("collapses more than 2 distinct names to '+N'", () => {
    const steps = [
      tool("t1", { toolName: "a" }),
      tool("t2", { toolName: "b" }),
      tool("t3", { toolName: "c" }),
      tool("t4", { toolName: "d" }),
    ];
    expect(summariseActivity(steps).namesLabel).toBe("a, b +2");
  });

  it("deduplicates repeated tool names", () => {
    const steps = [tool("t1", { toolName: "read" }), tool("t2", { toolName: "read" })];
    expect(summariseActivity(steps).namesLabel).toBe("read");
  });

  it("collects distinct server display names from server-origin steps only", () => {
    const steps = [
      tool("t1", { toolOrigin: { kind: "server", serverId: "s1", serverName: "GitHub" } }),
      tool("t2", { toolOrigin: { kind: "server", serverId: "s1", serverName: "GitHub" } }),
      tool("t3", { toolOrigin: { kind: "page" } }),
    ];
    expect(summariseActivity(steps).serverNames).toEqual(["GitHub"]);
  });

  it("counts errors, denials and approvals independently", () => {
    const steps = [
      tool("t1", { toolStatus: "error" }),
      tool("t2", { toolStatus: "denied" }),
      tool("t3", { toolMode: "approved" }),
      tool("t4", { toolStatus: "success", toolMode: "auto" }),
    ];
    const summary = summariseActivity(steps);
    expect(summary.errorCount).toBe(1);
    expect(summary.deniedCount).toBe(1);
    expect(summary.approvedCount).toBe(1);
  });

  it.each([
    ["an error", [tool("t1", { toolStatus: "error" })], true],
    ["a denial", [tool("t1", { toolStatus: "denied" })], true],
    ["only clean successes", [tool("t1", { toolStatus: "success" })], false],
  ] as const)("needsAttention is %s -> %s", (_label, steps, expected) => {
    expect(summariseActivity(steps).needsAttention).toBe(expected);
  });
});
