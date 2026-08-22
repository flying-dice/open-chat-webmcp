// Component tests for Transcript.svelte (card 84, decisions/30-vitest-test-pyramid.md).
//
// Mocks the two module-singleton stores Transcript imports directly
// (../stores/approvals.svelte, ../stores/selection.svelte) — see this
// file's header pattern in the card brief. Every child Transcript renders
// (ActivityGroup, ActivityIndicator, ApprovalCard, MessageActions,
// Markdown, IconButton, Icon) is left real: only the store singletons are
// faked, never a `.svelte` component.
//
// Deliberately no `vi.resetModules()` anywhere — confirmed elsewhere in this
// codebase's history to corrupt Svelte's internal module state and crash any
// bits-ui component (Tooltip, Collapsible — both used here, transitively via
// IconButton/ActivityGroup) mounted afterward.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import type { TranscriptEntry, TurnPhase } from "../../domain/chat";

const state = vi.hoisted(() => ({ pending: [] as unknown[] }));

vi.mock("../stores/approvals.svelte", () => ({
  approvals: {
    get pending() {
      return state.pending;
    },
  },
  approve: vi.fn(),
  deny: vi.fn(),
}));

const openOptionsPage = vi.fn();
vi.mock("../stores/selection.svelte", () => ({
  openOptionsPage: (...args: unknown[]) => openOptionsPage(...args),
}));

import Transcript from "./Transcript.svelte";
import { m } from "../../paraglide/messages.js";

// jsdom does not implement Element.scrollTo at all (not even as a no-op) —
// Transcript's own autoscroll effect calls it unconditionally on mount, so
// every test needs this stub in place before `render()`.
Element.prototype.scrollTo = vi.fn();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userMsg(id: string, content: string): TranscriptEntry {
  return { id, role: "user", content, createdAt: 0 };
}

function assistantMsg(
  id: string,
  content: string,
  extra: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return { id, role: "assistant", content, createdAt: 0, ...extra };
}

function toolStep(id: string, toolName: string): TranscriptEntry {
  return {
    id,
    role: "tool",
    content: "the result",
    createdAt: 0,
    toolName,
    toolCallId: id,
    toolArgs: {},
    toolStatus: "success",
    toolMode: "auto",
  };
}

interface TestProps {
  messages: TranscriptEntry[];
  streamingMessageId: string | null;
  turnPhase: TurnPhase | null;
  onRetry: () => void;
  toolsNotice?: string;
  notices?: ReturnType<typeof createRawSnippet>;
  modelLabel?: string;
}

function baseProps(overrides: Partial<TestProps> = {}): TestProps {
  return {
    messages: [],
    streamingMessageId: null,
    turnPhase: null,
    onRetry: vi.fn(),
    ...overrides,
  };
}

// @testing-library/svelte does not auto-register its cleanup hook unless
// Vitest's test.globals is on (this repo's vitest.config.ts deliberately
// leaves it off) — without this, a component mounted by one test is still
// in the DOM for the next, producing spurious "multiple elements found"
// failures.
afterEach(() => cleanup());

describe("Transcript", () => {
  describe("renders messages/groups", () => {
    it("renders a user turn as a pill and an assistant turn's content via Markdown", () => {
      render(Transcript, {
        props: baseProps({
          messages: [userMsg("u1", "Hello there"), assistantMsg("a1", "General Kenobi")],
        }),
      });

      expect(screen.getByText("Hello there")).toBeInTheDocument();
      expect(screen.getByText("General Kenobi")).toBeInTheDocument();
    });

    it("renders a run of consecutive tool entries as one ActivityGroup", () => {
      render(Transcript, {
        props: baseProps({
          messages: [
            userMsg("u1", "do the thing"),
            toolStep("t1", "read_page"),
            toolStep("t2", "click_button"),
          ],
        }),
      });

      // ActivityGroup's collapsed summary line: "<count> tool calls · <names>".
      expect(
        screen.getByText(new RegExp(m.activityGroup_stepCount({ count: 2 }))),
      ).toBeInTheDocument();
      expect(screen.getByText(/read_page, click_button/)).toBeInTheDocument();
    });

    it("shows the empty state, plus toolsNotice, when there are no messages", () => {
      render(Transcript, {
        props: baseProps({ messages: [], toolsNotice: "This page publishes no WebMCP tools." }),
      });

      expect(screen.getByText(m.transcript_emptyMessage())).toBeInTheDocument();
      expect(screen.getByText("This page publishes no WebMCP tools.")).toBeInTheDocument();
    });

    it("omits toolsNotice when unset", () => {
      render(Transcript, { props: baseProps({ messages: [] }) });

      expect(screen.getByText(m.transcript_emptyMessage())).toBeInTheDocument();
    });
  });

  describe("chaos: assistant content is rendered sanitized end to end", () => {
    it("neutralises an HTML/script injection attempt riding in an assistant message's content", () => {
      const { container } = render(Transcript, {
        props: baseProps({
          messages: [
            assistantMsg(
              "a1",
              'Here you go: <img src=x onerror="window.__pwned = true"><script>window.__pwned = true</script>',
            ),
          ],
        }),
      });

      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
      expect(screen.getByText(/Here you go:/)).toBeInTheDocument();
    });
  });

  describe("jump-to-latest visibility (autoscroll pinning state)", () => {
    it("is absent while jsdom reports the container as already at the bottom", () => {
      render(Transcript, {
        props: baseProps({ messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello")] }),
      });

      // jsdom's default scrollHeight/clientHeight are both 0, so the
      // component's `atBottom` derivation starts (and stays) true.
      expect(
        screen.queryByRole("button", { name: m.transcript_jumpToLatestLabel() }),
      ).not.toBeInTheDocument();
    });

    it("appears once a scroll event reports the container is scrolled away from the bottom, and clears on click", async () => {
      const { container } = render(Transcript, {
        props: baseProps({ messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello")] }),
      });

      const scrollEl = container.querySelector(".overflow-y-auto");
      expect(scrollEl).not.toBeNull();
      const el = scrollEl as HTMLDivElement;

      // Simulate "scrolled up": distance = scrollHeight - scrollTop - clientHeight
      // = 1000 - 0 - 400 = 600, well past the component's 48px threshold.
      Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
      Object.defineProperty(el, "scrollTop", { value: 0, configurable: true, writable: true });
      await fireEvent.scroll(el);

      const jumpButton = screen.getByRole("button", { name: m.transcript_jumpToLatestLabel() });
      expect(jumpButton).toBeInTheDocument();

      // Clicking calls scrollTo (a jsdom no-op) and sets atBottom = true
      // synchronously right after, regardless of that no-op.
      await fireEvent.click(jumpButton);
      expect(
        screen.queryByRole("button", { name: m.transcript_jumpToLatestLabel() }),
      ).not.toBeInTheDocument();
    });
  });

  describe("notices snippet", () => {
    it("renders the notices snippet above the messages", () => {
      const notices = createRawSnippet(() => ({
        render: () => `<p>Custom notice</p>`,
      }));

      render(Transcript, {
        props: baseProps({ messages: [userMsg("u1", "hi")], notices }),
      });

      expect(screen.getByText("Custom notice")).toBeInTheDocument();
      expect(screen.getByText("hi")).toBeInTheDocument();
    });
  });

  describe("retry / open-options / regenerate actions", () => {
    it("renders a Retry button for a 'retry' action, calling onRetry", async () => {
      const onRetry = vi.fn();
      render(Transcript, {
        props: baseProps({
          messages: [assistantMsg("a1", "Something went wrong.", { actions: [{ kind: "retry" }] })],
          onRetry,
        }),
      });

      await fireEvent.click(screen.getByRole("button", { name: m.retryAction() }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("renders the action's own label for an 'open-options' action, calling openOptionsPage", async () => {
      openOptionsPage.mockClear();
      render(Transcript, {
        props: baseProps({
          messages: [
            assistantMsg("a1", "Auth failed.", {
              actions: [{ kind: "open-options", label: "Open options to check the API key" }],
            }),
          ],
        }),
      });

      await fireEvent.click(
        screen.getByRole("button", { name: "Open options to check the API key" }),
      );
      expect(openOptionsPage).toHaveBeenCalledTimes(1);
    });

    it("renders MessageActions with a working Regenerate for the last non-empty, non-streaming assistant message", async () => {
      const onRetry = vi.fn();
      render(Transcript, {
        props: baseProps({
          messages: [userMsg("u1", "hi"), assistantMsg("a1", "hello there")],
          streamingMessageId: null,
          onRetry,
        }),
      });

      const regenerate = screen.getByRole("button", { name: m.messageActions_regenerateLabel() });
      await fireEvent.click(regenerate);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("does not render Regenerate for the currently-streaming assistant message", () => {
      render(Transcript, {
        props: baseProps({
          messages: [userMsg("u1", "hi"), assistantMsg("a1", "typing...")],
          streamingMessageId: "a1",
        }),
      });

      expect(
        screen.queryByRole("button", { name: m.messageActions_regenerateLabel() }),
      ).not.toBeInTheDocument();
    });
  });
});
