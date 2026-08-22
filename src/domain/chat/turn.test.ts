import { describe, it, expect, vi } from "vitest";
import { runTurn, buildSystemPrompt, MAX_ITERATIONS, type TurnTranscript } from "./turn";
import {
  assistantEntry,
  toolEntry,
  UNTRUSTED_CONTENT_START,
  UNTRUSTED_CONTENT_END,
  type NoteAction,
} from "./message";
import { createChat, type ChatSession } from "./session";
import type {
  ApprovalDecision,
  ApprovalRequester,
  ModelGateway,
  PageContext,
  TurnPresenter,
} from "./ports";
import type { TurnPhase } from "./turn-phase";
import type { ChatParams, ChatStreamEvent } from "../providers";
import type { MergedTool, ToolOrigin } from "../tools";

// ---------------------------------------------------------------------------
// Shared fakes — small and focused rather than one mega-fake (per the card's
// style guidance). None of these import chrome/fetch/DOM/Svelte; they only
// implement this context's own port interfaces (./ports.ts) plus the
// transcript-writing half of ChatService (./turn.ts's own TurnTranscript).
// ---------------------------------------------------------------------------

const page: PageContext = { tabId: 1, title: "Example Page", origin: "https://example.com" };

const originLabel = (origin: ToolOrigin): string =>
  origin.kind === "page" ? "this page" : origin.serverName;

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function doneEvent(): ChatStreamEvent {
  return { type: "done", message: { role: "assistant", content: "" }, stats: {} };
}

/** Yields each round's scripted events in turn, one round per `.chat()` call. Records every request so a test can inspect what the model was actually sent. */
function scriptedGateway(rounds: ChatStreamEvent[][]): ModelGateway & { requests: ChatParams[] } {
  const requests: ChatParams[] = [];
  let round = 0;
  return {
    requests,
    async *chat(params) {
      requests.push(params);
      const events = rounds[round] ?? [];
      round += 1;
      for (const event of events) yield event;
    },
  };
}

function makeTool(opts: {
  name: string;
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  origin?: ToolOrigin;
  call?: MergedTool["call"];
}): MergedTool {
  return {
    name: opts.name,
    description: `${opts.name} tool`,
    annotations: {
      readOnlyHint: opts.readOnlyHint ?? false,
      untrustedContentHint: opts.untrustedContentHint ?? false,
    },
    origin: opts.origin ?? { kind: "page" },
    call: opts.call ?? (async () => ({ ok: true, result: "default result" })),
  };
}

function makePresenter(): {
  presenter: TurnPresenter;
  phases: (TurnPhase | null)[];
  streaming: (string | null)[];
} {
  const phases: (TurnPhase | null)[] = [];
  const streaming: (string | null)[] = [];
  const presenter: TurnPresenter = {
    phaseChanged: (_chatId, phase) => phases.push(phase),
    streamingChanged: (_chatId, id) => streaming.push(id),
    modelContact: () => undefined,
    waitUntilVisible: () => Promise.resolve(),
  };
  return { presenter, phases, streaming };
}

/**
 * A minimal, faithful implementation of TurnTranscript over a real
 * ChatSession — it mutates `target.messages` using this context's own
 * constructors (./message.ts), the same vocabulary `ChatService` writes with,
 * without depending on service.ts's persistence/call-log side effects
 * (those are exercised in service.test.ts instead).
 */
function makeTranscript(defaultTarget: ChatSession): {
  transcript: TurnTranscript;
  notes: { content: string; actions?: NoteAction[] }[];
} {
  const notes: { content: string; actions?: NoteAction[] }[] = [];
  let counter = 0;

  const transcript: TurnTranscript = {
    beginAssistantMessage(target = defaultTarget) {
      const id = `msg-${counter++}`;
      target.messages.push(assistantEntry(id, Date.now()));
      return id;
    },
    appendAssistantDelta(id, delta, target = defaultTarget) {
      const entry = target.messages.find((m) => m.id === id);
      if (entry) entry.content += delta;
    },
    endAssistantMessage(id, toolCalls, target = defaultTarget) {
      const entry = target.messages.find((m) => m.id === id);
      if (entry && toolCalls && toolCalls.length > 0) entry.toolCalls = toolCalls;
    },
    addToolCall(call, snapshot, target = defaultTarget) {
      // A fresh per-instance id — NOT call.id — mirroring production
      // (./service.ts's addToolCall): two calls in the same round can share
      // a call.id (card 87), and each still needs its own addressable
      // transcript entry.
      const id = `tool-${counter++}`;
      target.messages.push(toolEntry(id, call, snapshot, Date.now()));
      return id;
    },
    updateToolCallResult(id, outcome, target = defaultTarget) {
      const entry = target.messages.find((m) => m.id === id);
      if (entry) {
        entry.toolStatus = outcome.status;
        entry.content = outcome.content;
      }
    },
    addAssistantNote(content, actions, target = defaultTarget) {
      const id = transcript.beginAssistantMessage(target);
      transcript.appendAssistantDelta(id, content, target);
      transcript.endAssistantMessage(id, undefined, target);
      if (actions && actions.length > 0) {
        const entry = target.messages.find((m) => m.id === id);
        if (entry) entry.actions = actions;
      }
      notes.push({ content, actions });
      return id;
    },
  };

  return { transcript, notes };
}

const neverApprove: ApprovalRequester = vi.fn(async () => "denied" as ApprovalDecision);

// Deliberately does NOT default `signal` — every call site passes its own
// explicitly (usually `new AbortController().signal`), and this is spread
// AFTER that explicit `signal:` in every runTurn(...) call below. A default
// here would silently win the spread and mask a real AbortController's
// signal with an unrelated, never-aborted one — exactly the bug this
// comment is here to stop someone from reintroducing.
function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    modelId: "test-model",
    tools: { toolsForTurn: async () => [] },
    approvals: neverApprove,
    policy: { mayAutoRun: async () => false },
    page,
    attachTools: false,
    originLabel,
    toolCallTimeoutMs: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("names the page's title and origin", () => {
    const prompt = buildSystemPrompt(page, [], originLabel);
    expect(prompt).toContain(page.title);
    expect(prompt).toContain(page.origin);
  });

  it("states plainly that no tools are available when the tool list is empty", () => {
    const prompt = buildSystemPrompt(page, [], originLabel);
    expect(prompt).toContain("does not currently expose any callable tools");
  });

  it("lists each tool's name, origin label and description when tools are available", () => {
    const tool = makeTool({ name: "get_title", readOnlyHint: true });
    const prompt = buildSystemPrompt(page, [tool], originLabel);
    expect(prompt).toContain("get_title");
    expect(prompt).toContain(tool.description!);
    expect(prompt).toContain(originLabel(tool.origin));
  });

  it("always states the untrusted-content rule and names the fence delimiters", () => {
    const prompt = buildSystemPrompt(page, [], originLabel);
    expect(prompt).toContain(UNTRUSTED_CONTENT_START);
    expect(prompt).toContain(UNTRUSTED_CONTENT_END);
  });
});

// ---------------------------------------------------------------------------
// 1. Plain streaming reply
// ---------------------------------------------------------------------------

describe("runTurn — plain streaming reply", () => {
  it("assembles content deltas into the final assistant message with no tool calls", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const gateway = scriptedGateway([
      [{ type: "content", delta: "Hello" }, { type: "content", delta: ", world" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts(),
    });

    const assistantMessages = session.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe("Hello, world");
    expect(gateway.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Read-only tool auto-runs
// ---------------------------------------------------------------------------

describe("runTurn — read-only tool auto-run", () => {
  it("auto-runs without an approval wait and gives the model a second round with the result", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter, phases } = makePresenter();
    const readTool = makeTool({
      name: "get_title",
      readOnlyHint: true,
      call: vi.fn(async () => ({ ok: true as const, result: "Example Domain" })),
    });
    const approvals = vi.fn(async () => "denied" as ApprovalDecision);

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "get_title", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "The title is Example Domain" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [readTool] },
        approvals,
        policy: { mayAutoRun: async (tool: MergedTool | undefined) => tool?.annotations.readOnlyHint === true },
        attachTools: true,
      }),
    });

    expect(approvals).not.toHaveBeenCalled();
    expect(phases.some((p) => p?.kind === "awaiting-approval")).toBe(false);
    expect(gateway.requests).toHaveLength(2);

    const toolResult = session.messages.find((m) => m.role === "tool");
    expect(toolResult?.toolStatus).toBe("success");
    expect(toolResult?.content).toBe("Example Domain");
    expect(toolResult?.toolMode).toBe("auto");

    const secondRoundMessages = gateway.requests[1].messages;
    expect(
      secondRoundMessages.some((m) => m.role === "tool" && m.content === "Example Domain"),
    ).toBe(true);

    const finalAssistant = session.messages.filter((m) => m.role === "assistant").at(-1);
    expect(finalAssistant?.content).toBe("The title is Example Domain");
  });
});

// ---------------------------------------------------------------------------
// 3. Denial is terminal for that call
// ---------------------------------------------------------------------------

describe("runTurn — denied tool call", () => {
  it("is terminal for that call and is read back by the model as denied, not thrown or retried", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const mutatingTool = makeTool({ name: "delete_item", call: vi.fn(async () => ({ ok: true as const, result: "x" })) });
    const approvals = vi.fn(async () => "denied" as ApprovalDecision);

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "delete_item", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "Okay, I won't delete it." }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [mutatingTool] },
        approvals,
        policy: { mayAutoRun: async () => false },
        attachTools: true,
      }),
    });

    expect(approvals).toHaveBeenCalledTimes(1);
    expect(mutatingTool.call).not.toHaveBeenCalled();

    const toolResult = session.messages.find((m) => m.role === "tool");
    expect(toolResult?.toolStatus).toBe("denied");
    expect(toolResult?.content).toBe("The user denied this tool call.");

    // A denial is NOT a dead end — the model gets a second round and can
    // read the denial back as a normal tool result.
    expect(gateway.requests).toHaveLength(2);
    const secondRoundMessages = gateway.requests[1].messages;
    expect(
      secondRoundMessages.some(
        (m) => m.role === "tool" && m.content === "The user denied this tool call.",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Untrusted-content fencing
// ---------------------------------------------------------------------------

describe("runTurn — untrusted-content fencing", () => {
  it("fences an untrusted tool result for the model only, and never leaks UI-only fields onto the outgoing message", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const untrustedTool = makeTool({
      name: "fetch_remote",
      readOnlyHint: true,
      untrustedContentHint: true,
      call: async () => ({ ok: true, result: "attacker-controlled text" }),
    });

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "fetch_remote", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "ok" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [untrustedTool] },
        approvals: vi.fn(async () => "approved" as ApprovalDecision),
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    // Stored/displayed transcript entry is untouched — plain, unfenced text.
    const storedEntry = session.messages.find((m) => m.role === "tool");
    expect(storedEntry?.content).toBe("attacker-controlled text");

    // The copy sent to the model on the next round is fenced.
    const secondRoundMessages = gateway.requests[1].messages;
    const modelToolMessage = secondRoundMessages.find((m) => m.role === "tool")!;
    expect(modelToolMessage.content.startsWith(UNTRUSTED_CONTENT_START)).toBe(true);
    expect(modelToolMessage.content).toContain("attacker-controlled text");
    expect(modelToolMessage.content.endsWith(UNTRUSTED_CONTENT_END)).toBe(true);

    // And the outgoing message never carries anything beyond the provider
    // wire shape — no toolArgs/toolStatus/annotations/actions.
    expect(Object.keys(modelToolMessage).sort()).toEqual(
      ["role", "content", "toolCalls", "toolCallId", "toolName"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. MAX_ITERATIONS trips
// ---------------------------------------------------------------------------

describe("runTurn — MAX_ITERATIONS cap", () => {
  it(`stops after ${MAX_ITERATIONS} tool-call rounds and appends a note instead of looping forever`, async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const loopTool = makeTool({ name: "loop_tool", readOnlyHint: true });

    let round = 0;
    const requests: ChatParams[] = [];
    const gateway: ModelGateway & { requests: ChatParams[] } = {
      requests,
      async *chat(params) {
        requests.push(params);
        round += 1;
        yield { type: "tool-calls", toolCalls: [{ id: `call-${round}`, name: "loop_tool", arguments: {} }] };
        yield doneEvent();
      },
    };

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [loopTool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    expect(gateway.requests).toHaveLength(MAX_ITERATIONS);
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain(`Stopped after ${MAX_ITERATIONS} tool-call rounds`);
  });
});

// ---------------------------------------------------------------------------
// 6. Hanging tool call bounded by toolCallTimeoutMs
// ---------------------------------------------------------------------------

describe("runTurn — hanging tool call", () => {
  it("bounds a tool call that never resolves with the injected toolCallTimeoutMs, producing a timeout error rather than hanging", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const hangingTool = makeTool({ name: "hang", readOnlyHint: true, call: () => new Promise(() => {}) });

    const gateway = scriptedGateway([
      [{ type: "tool-calls", toolCalls: [{ id: "call-1", name: "hang", arguments: {} }] }, doneEvent()],
      [{ type: "content", delta: "done" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [hangingTool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
        toolCallTimeoutMs: 50,
      }),
    });

    const result = session.messages.find((m) => m.role === "tool");
    expect(result?.toolStatus).toBe("error");
    expect(result?.content).toBe("Tool call timed out after 0.05s.");
  });
});

// ---------------------------------------------------------------------------
// 7. Hallucinated/unknown tool name
// ---------------------------------------------------------------------------

describe("runTurn — hallucinated tool name", () => {
  it("resolves an unknown tool name as a clean tool-result error, not a throw", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "does_not_exist", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "sorry about that" }, doneEvent()],
    ]);

    await expect(
      runTurn({
        target: session,
        transcript,
        model: gateway,
        presenter,
        signal: new AbortController().signal,
        ...baseOpts({
          tools: { toolsForTurn: async () => [] },
          policy: { mayAutoRun: async () => true },
          attachTools: true,
        }),
      }),
    ).resolves.toBeUndefined();

    const result = session.messages.find((m) => m.role === "tool");
    expect(result?.toolStatus).toBe("error");
    expect(result?.content).toContain('"does_not_exist" isn\'t in this turn\'s tool list');
    expect(gateway.requests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 8. A throwing ModelGateway
// ---------------------------------------------------------------------------

describe("runTurn — a ModelGateway that violates its never-throw contract", () => {
  it("treats a thrown stream as a retryable terminal note rather than crashing the loop", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();

    const throwingGateway: ModelGateway = {
      async *chat() {
        throw new Error("connection reset");
      },
    };

    await expect(
      runTurn({
        target: session,
        transcript,
        model: throwingGateway,
        presenter,
        signal: new AbortController().signal,
        ...baseOpts(),
      }),
    ).resolves.toBeUndefined();

    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain("connection reset");
    expect(notes[0].actions).toEqual([{ kind: "retry" }]);
  });
});

// ---------------------------------------------------------------------------
// 9. A turn's writes stay bound to its own captured target
// ---------------------------------------------------------------------------

describe("runTurn — target isolation between concurrent turns", () => {
  it("never writes to a different chat's session, even while another turn runs concurrently", async () => {
    const sessionA = createChat("https://a.example.com");
    const sessionB = createChat("https://b.example.com");
    const { transcript: transcriptA } = makeTranscript(sessionA);
    const { transcript: transcriptB } = makeTranscript(sessionB);
    const { presenter: presenterA } = makePresenter();
    const { presenter: presenterB } = makePresenter();

    const gateA = deferred();
    const reachedGate = deferred();
    const gatewayA: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "A-first " };
        reachedGate.resolve();
        await gateA.promise;
        yield { type: "content", delta: "A-second" };
        yield doneEvent();
      },
    };
    const gatewayB: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "B-only" };
        yield doneEvent();
      },
    };

    const turnA = runTurn({
      target: sessionA,
      transcript: transcriptA,
      model: gatewayA,
      presenter: presenterA,
      signal: new AbortController().signal,
      ...baseOpts(),
    });

    // Wait until A has written its first delta and parked mid-stream before
    // starting and finishing B entirely.
    await reachedGate.promise;

    const turnB = runTurn({
      target: sessionB,
      transcript: transcriptB,
      model: gatewayB,
      presenter: presenterB,
      signal: new AbortController().signal,
      ...baseOpts(),
    });
    await turnB;

    expect(sessionB.messages.find((m) => m.role === "assistant")?.content).toBe("B-only");
    // A must be completely unaffected by B running to completion in between.
    expect(sessionA.messages.find((m) => m.role === "assistant")?.content).toBe("A-first ");

    gateA.resolve();
    await turnA;

    expect(sessionA.messages.find((m) => m.role === "assistant")?.content).toBe("A-first A-second");
    expect(sessionB.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 14. Stop mid-turn
// ---------------------------------------------------------------------------

describe("runTurn — stop mid-turn", () => {
  it("keeps the partial reply as-is and adds no extra note when the abort signal fires mid-stream", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const controller = new AbortController();

    const gate = deferred();
    const reachedGate = deferred();
    const gateway: ModelGateway = {
      async *chat() {
        yield { type: "content", delta: "Partial reply" };
        reachedGate.resolve();
        await gate.promise;
        yield { type: "error", error: { kind: "aborted" } };
      },
    };

    const turn = runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: controller.signal,
      ...baseOpts(),
    });

    await reachedGate.promise;
    controller.abort();
    gate.resolve();
    await turn;

    const assistantMessages = session.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe("Partial reply");
    expect(notes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 15. Stop during an approval wait
// ---------------------------------------------------------------------------

describe("runTurn — stop during an approval wait", () => {
  it("denies the call via raceApproval instead of hanging forever", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const controller = new AbortController();
    const mutatingTool = makeTool({ name: "delete_item", call: vi.fn(async () => ({ ok: true as const, result: "x" })) });

    const approvalRequested = deferred();
    const pendingApproval = new Promise<ApprovalDecision>(() => {
      // Never resolves on its own — only the abort signal can end the wait.
    });
    const approvals = vi.fn(() => {
      approvalRequested.resolve();
      return pendingApproval;
    });

    const gateway = scriptedGateway([
      [{ type: "tool-calls", toolCalls: [{ id: "call-1", name: "delete_item", arguments: {} }] }, doneEvent()],
    ]);

    const turn = runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: controller.signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [mutatingTool] },
        approvals,
        policy: { mayAutoRun: async () => false },
        attachTools: true,
      }),
    });

    await approvalRequested.promise;
    controller.abort();
    await turn;

    const result = session.messages.find((m) => m.role === "tool");
    expect(result?.toolStatus).toBe("denied");
    expect(result?.content).toBe("The user denied this tool call.");
    expect(gateway.requests).toHaveLength(1); // no second round after a stop
    expect(mutatingTool.call).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Extra tool-call and stream-error edge cases
// ---------------------------------------------------------------------------

describe("runTurn — further tool-call edge cases", () => {
  it("stops running further tool calls in the same round once the abort signal fires between them", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const controller = new AbortController();
    const secondCall = vi.fn(async () => ({ ok: true as const, result: "should not run" }));
    const toolA = makeTool({
      name: "a",
      readOnlyHint: true,
      call: async () => {
        controller.abort();
        return { ok: true, result: "a-result" };
      },
    });
    const toolB = makeTool({ name: "b", readOnlyHint: true, call: secondCall });

    const gateway = scriptedGateway([
      [
        {
          type: "tool-calls",
          toolCalls: [
            { id: "call-a", name: "a", arguments: {} },
            { id: "call-b", name: "b", arguments: {} },
          ],
        },
        doneEvent(),
      ],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: controller.signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [toolA, toolB] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    expect(secondCall).not.toHaveBeenCalled();
    const toolResults = session.messages.filter((m) => m.role === "tool");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolName).toBe("a");
  });

  it("also picks up tool calls carried on the terminal 'done' event, not just a separate 'tool-calls' event", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const tool = makeTool({
      name: "get_title",
      readOnlyHint: true,
      call: async () => ({ ok: true, result: "Example Domain" }),
    });

    const gateway = scriptedGateway([
      [
        {
          type: "done",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call-1", name: "get_title", arguments: {} }],
          },
          stats: {},
        },
      ],
      [{ type: "content", delta: "ok" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [tool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    const toolResult = session.messages.find((m) => m.role === "tool");
    expect(toolResult?.content).toBe("Example Domain");
  });

  it("truncates an oversized tool result and JSON-stringifies a non-string result", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const huge = { data: "x".repeat(9000) };
    const tool = makeTool({ name: "dump", readOnlyHint: true, call: async () => ({ ok: true, result: huge }) });

    const gateway = scriptedGateway([
      [{ type: "tool-calls", toolCalls: [{ id: "call-1", name: "dump", arguments: {} }] }, doneEvent()],
      [{ type: "content", delta: "ok" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [tool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    const toolResult = session.messages.find((m) => m.role === "tool")!;
    expect(toolResult.content.startsWith('{\n  "data"')).toBe(true); // JSON.stringify formatting
    expect(toolResult.content.endsWith("… (truncated)")).toBe(true);
    expect(toolResult.content.length).toBeLessThan(JSON.stringify(huge).length);
  });
});

describe("runTurn — terminal stream error note wording", () => {
  it("includes a copy-pasteable fix command for an unreachable-or-cors error that carries one", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const gateway: ModelGateway = {
      async *chat() {
        yield {
          type: "error",
          error: {
            kind: "unreachable-or-cors",
            message: "Could not reach the server.",
            fix: { label: "Set this environment variable", command: "OLLAMA_ORIGINS=* ollama serve" },
          },
        };
      },
    };

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts(),
    });

    expect(notes[0].content).toContain("Could not reach the server.");
    expect(notes[0].content).toContain("OLLAMA_ORIGINS=* ollama serve");
    expect(notes[0].actions).toEqual([{ kind: "retry" }]);
  });

  it("offers an 'open options' action chip alongside retry for an auth failure", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const gateway: ModelGateway = {
      async *chat() {
        yield { type: "error", error: { kind: "auth", status: 401, message: "Invalid API key" } };
      },
    };

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts(),
    });

    expect(notes[0].actions).toEqual([
      { kind: "retry" },
      { kind: "open-options", label: "Open options to check the API key" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Turn phase transitions (turn-phase.ts), as the loop sequences them
// ---------------------------------------------------------------------------

describe("turn phase transitions (turn-phase.ts)", () => {
  it("moves waiting -> streaming -> calling -> awaiting-approval -> calling -> waiting -> streaming for an approved mutating call", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter, phases } = makePresenter();
    const mutatingTool = makeTool({ name: "delete_item" });

    const gateway = scriptedGateway([
      [
        { type: "content", delta: "checking" },
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "delete_item", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "done" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [mutatingTool] },
        approvals: vi.fn(async () => "approved" as ApprovalDecision),
        policy: { mayAutoRun: async () => false },
        attachTools: true,
      }),
    });

    expect(phases.map((p) => p?.kind)).toEqual([
      "waiting", // runTurn's very first phase, set before the tool lookup
      "waiting", // start of iteration 1
      "streaming", // first content delta lands
      "calling", // tool resolved, before the policy read
      "awaiting-approval", // policy says a human must decide
      "calling", // approved — fresh startedAt, measuring the call itself
      "waiting", // start of iteration 2
      "streaming", // second round's content
    ]);
  });

  it("never enters awaiting-approval for a call the policy lets auto-run", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter, phases } = makePresenter();
    const readTool = makeTool({ name: "get_title", readOnlyHint: true });

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "get_title", arguments: {} }] },
        doneEvent(),
      ],
      [{ type: "content", delta: "ok" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [readTool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    expect(phases.some((p) => p?.kind === "awaiting-approval")).toBe(false);
    expect(phases.filter((p) => p?.kind === "calling")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Chaos: unhappy paths the suites above don't cover (card 85,
// .claude/skills/chaos-monkey/SKILL.md).
// ---------------------------------------------------------------------------

describe("chaos: duplicate tool-call ids from the model", () => {
  // FIXED on card 87 (was a known bug journalled on card 85): a
  // hallucinating/buggy model can emit two `tool_calls` entries sharing one
  // `id` in the same round. `toolEntry` (./message.ts) used to key a
  // transcript entry by `call.id` itself, so `ChatService.findEntry` (and
  // this file's own `makeTranscript` fake) resolved a later
  // `updateToolCallResult(id, ...)` with `Array.prototype.find`, which
  // always returns the FIRST entry with that id — clobbering the first
  // call's already-recorded outcome and leaving the second call's entry
  // stuck at `"pending"` forever. Fixed by minting a fresh, per-INSTANCE
  // entry id at call time (`ChatService.addToolCall`/the fake's
  // `addToolCall`, both via `toolEntry`'s new `id` parameter) instead of
  // reusing `call.id` — `toolCallId` still carries the model's own
  // (possibly duplicated) `call.id` separately, for matching a result back
  // to the model's request.
  it("resolves each duplicate-id call against its OWN transcript entry, not the first one", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const toolA = makeTool({ name: "a", readOnlyHint: true, call: async () => ({ ok: true, result: "A result" }) });
    const toolB = makeTool({ name: "b", readOnlyHint: true, call: async () => ({ ok: true, result: "B result" }) });

    const gateway = scriptedGateway([
      [
        {
          type: "tool-calls",
          toolCalls: [
            { id: "dup", name: "a", arguments: {} },
            { id: "dup", name: "b", arguments: {} },
          ],
        },
        doneEvent(),
      ],
      [{ type: "content", delta: "ok" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [toolA, toolB] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    const toolResults = session.messages.filter((m) => m.role === "tool");
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ toolName: "a", toolStatus: "success", content: "A result" });
    expect(toolResults[1]).toMatchObject({ toolName: "b", toolStatus: "success", content: "B result" });
  });
});

describe("chaos: partial failure across a round's tool calls", () => {
  it("keeps running (and correctly records) the remaining calls when the middle one of three fails", async () => {
    const session = createChat("https://example.com");
    const { transcript } = makeTranscript(session);
    const { presenter } = makePresenter();
    const toolA = makeTool({ name: "a", readOnlyHint: true, call: async () => ({ ok: true, result: "a-ok" }) });
    const toolB = makeTool({
      name: "b",
      readOnlyHint: true,
      call: async () => {
        throw new Error("b blew up");
      },
    });
    const toolC = makeTool({ name: "c", readOnlyHint: true, call: async () => ({ ok: true, result: "c-ok" }) });

    const gateway = scriptedGateway([
      [
        {
          type: "tool-calls",
          toolCalls: [
            { id: "call-a", name: "a", arguments: {} },
            { id: "call-b", name: "b", arguments: {} },
            { id: "call-c", name: "c", arguments: {} },
          ],
        },
        doneEvent(),
      ],
      [{ type: "content", delta: "summarised" }, doneEvent()],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [toolA, toolB, toolC] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    const toolResults = session.messages.filter((m) => m.role === "tool");
    expect(toolResults).toHaveLength(3);
    expect(toolResults[0]).toMatchObject({ toolName: "a", toolStatus: "success", content: "a-ok" });
    expect(toolResults[1]).toMatchObject({ toolName: "b", toolStatus: "error", content: "b blew up" });
    expect(toolResults[2]).toMatchObject({ toolName: "c", toolStatus: "success", content: "c-ok" });
    // The failure of call 2 did not end the turn early — the model still got
    // a second round with all three outcomes to summarise.
    expect(gateway.requests).toHaveLength(2);
    expect(session.messages.filter((m) => m.role === "assistant").at(-1)?.content).toBe("summarised");
  });
});

describe("chaos: stream reports tool calls then dies before 'done'", () => {
  // DECIDED on card 87 (was flagged, not guessed at, on card 85): a round
  // whose stream reports `tool-calls` and then dies with a terminal error
  // before `done` NEVER runs those calls. Chosen over "run them anyway"
  // because a round that never reached `done` gives no guarantee the
  // `tool-calls` seen so far are the model's COMPLETE, final list for that
  // round (a provider could still have been about to revise or add to it);
  // running tools — some of which may not be read-only — off an
  // unconfirmed, possibly-partial list is a real-world-side-effect risk a
  // silently-dropped list is not. The smallest honest alternative to
  // "guess and run" is "discard and let the human decide": the terminal
  // error already surfaces via `addAssistantNote`, and the note's `"retry"`
  // action (asserted below) gives the user an explicit way to get a FRESH,
  // fully-committed round — including the same tool calls, if the model
  // still wants them — rather than this module silently re-running
  // possibly-stale, possibly-incomplete ones itself.
  it("drops the uncommitted tool calls and surfaces the terminal error, rather than running or hanging", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const spy = vi.fn(async () => ({ ok: true as const, result: "should never run" }));
    const tool = makeTool({ name: "a", readOnlyHint: true, call: spy });

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "a", arguments: {} }] },
        { type: "error", error: { kind: "http", status: 500, statusText: "Internal Server Error", body: "" } },
      ],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [tool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    // Current behaviour: a terminal error anywhere in the round discards
    // whatever `tool-calls` already arrived — nothing is executed and no
    // tool-result entry is written.
    expect(spy).not.toHaveBeenCalled();
    expect(session.messages.some((m) => m.role === "tool")).toBe(false);
    expect(notes).toHaveLength(1);
    expect(gateway.requests).toHaveLength(1); // no second round was ever started
  });

  it("offers a Retry action on the discarded-tool-calls note, so the user has an explicit way to get a fresh, fully-committed round", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const spy = vi.fn(async () => ({ ok: true as const, result: "should never run" }));
    const tool = makeTool({ name: "a", readOnlyHint: true, call: spy });

    const gateway = scriptedGateway([
      [
        { type: "tool-calls", toolCalls: [{ id: "call-1", name: "a", arguments: {} }] },
        { type: "error", error: { kind: "http", status: 500, statusText: "Internal Server Error", body: "" } },
      ],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [tool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    expect(spy).not.toHaveBeenCalled();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.actions).toEqual([{ kind: "retry" }]);
  });
});

describe("chaos: stream dies immediately after a successful tool round, before any new text", () => {
  it("keeps the completed tool result in the transcript and adds a retry note, without a stray empty reply", async () => {
    const session = createChat("https://example.com");
    const { transcript, notes } = makeTranscript(session);
    const { presenter } = makePresenter();
    const tool = makeTool({ name: "lookup", readOnlyHint: true, call: async () => ({ ok: true, result: "found it" }) });

    const gateway = scriptedGateway([
      [{ type: "tool-calls", toolCalls: [{ id: "call-1", name: "lookup", arguments: {} }] }, doneEvent()],
      // Round 2: the model never streams anything before the connection dies.
      [{ type: "error", error: { kind: "invalid-response", message: "connection reset" } }],
    ]);

    await runTurn({
      target: session,
      transcript,
      model: gateway,
      presenter,
      signal: new AbortController().signal,
      ...baseOpts({
        tools: { toolsForTurn: async () => [tool] },
        policy: { mayAutoRun: async () => true },
        attachTools: true,
      }),
    });

    const toolResult = session.messages.find((m) => m.role === "tool");
    expect(toolResult).toMatchObject({ toolStatus: "success", content: "found it" });
    expect(notes).toHaveLength(1);
    expect(notes[0].actions).toEqual([{ kind: "retry" }]);
    // Round 2's own (empty) assistant bubble stays empty rather than being
    // dropped or fused with the note — endAssistantMessage already closed it.
    const assistantEntries = session.messages.filter((m) => m.role === "assistant");
    expect(assistantEntries.some((m) => m.content === "")).toBe(true);
  });
});
