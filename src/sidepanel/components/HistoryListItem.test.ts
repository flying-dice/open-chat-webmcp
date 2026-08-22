// Card 84 (decisions/30-vitest-test-pyramid.md). HistoryListItem.svelte takes
// only plain props — no store, no app-services — so this needs no mocking at
// all.
//
// `@testing-library/svelte/vitest` is imported for its side effect only: it
// registers a `beforeEach`/teardown that calls `cleanup()` after every test.
// vitest.setup.ts (owned by a parallel agent on this card, not touched here)
// does not register this globally, so each component test file imports it
// itself — without it, DOM from one `it()` leaks into the next and
// `getByRole` starts finding duplicates.
import "@testing-library/svelte/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import HistoryListItem from "./HistoryListItem.svelte";
import type { ChatSummary } from "../../domain/chat";

function summary(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: "chat-1",
    origin: "https://example.com",
    createdAt: 1000,
    updatedAt: 2000,
    messageCount: 3,
    toolCallCount: 1,
    preview: "hello there",
    ...overrides,
  };
}

describe("HistoryListItem", () => {
  it("renders title, origin, time and counts", () => {
    render(HistoryListItem, {
      props: {
        summary: summary(),
        active: false,
        opening: false,
        deleting: false,
        onOpen: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/3 messages/)).toBeInTheDocument();
    expect(screen.getByText(/1 tool call/)).toBeInTheDocument();
  });

  it("calls onOpen when the row body is clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(HistoryListItem, {
      props: {
        summary: summary(),
        active: false,
        opening: false,
        deleting: false,
        onOpen,
        onDelete: vi.fn(),
      },
    });

    await user.click(screen.getByRole("button", { name: /hello there/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete without also calling onOpen (stopPropagation)", async () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(HistoryListItem, {
      props: {
        summary: summary(),
        active: false,
        opening: false,
        deleting: false,
        onOpen,
        onDelete,
      },
    });

    await user.click(screen.getByRole("button", { name: /Delete chat from https:\/\/example\.com/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a 'current' badge when active, none when inactive", () => {
    const { unmount } = render(HistoryListItem, {
      props: {
        summary: summary(),
        active: true,
        opening: false,
        deleting: false,
        onOpen: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(screen.getByText("current")).toBeInTheDocument();
    unmount();

    render(HistoryListItem, {
      props: {
        summary: summary(),
        active: false,
        opening: false,
        deleting: false,
        onOpen: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(screen.queryByText("current")).not.toBeInTheDocument();
  });

  it("disables the row and delete button while opening or deleting", () => {
    const { unmount } = render(HistoryListItem, {
      props: {
        summary: summary(),
        active: false,
        opening: true,
        deleting: false,
        onOpen: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(screen.getByRole("button", { name: /hello there/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete chat from https:\/\/example\.com/ })).toBeDisabled();
    unmount();

    render(HistoryListItem, {
      props: {
        summary: summary(),
        active: false,
        opening: false,
        deleting: true,
        onOpen: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(screen.getByRole("button", { name: /hello there/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Deleting…/ })).toBeDisabled();
  });
});
