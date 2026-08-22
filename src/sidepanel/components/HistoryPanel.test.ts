// Card 84 (decisions/30-vitest-test-pyramid.md). HistoryPanel.svelte reads
// `sidePanelServices()`/`chat()` (app-services) directly plus the read-only
// `panel` store, so this drives it through
// src/sidepanel/testing/fake-services.ts's fake bundle, initialised ONCE per
// file (never `vi.resetModules()` — see that helper's header comment for the
// Svelte-double-instance crash that caused).
import "@testing-library/svelte/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import HistoryPanel from "./HistoryPanel.svelte";
import { createFakeSidePanelServices, initFakeSidePanelServices } from "../testing/fake-services";
import type { ChatSummary } from "../../domain/chat";

// jsdom has no ResizeObserver. HistoryPanel wraps its list in shadcn-svelte's
// ScrollArea (bits-ui), which observes its content node to decide whether to
// show a scrollbar — irrelevant to anything this file asserts, but its
// `$effect` throws immediately on mount without this stub.
import "../../ui/testing/resize-observer";

function summary(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: "chat-1",
    origin: "https://example.com",
    createdAt: 1000,
    updatedAt: 2000,
    messageCount: 1,
    toolCallCount: 0,
    preview: "hi there",
    ...overrides,
  };
}

describe("HistoryPanel", () => {
  const services = createFakeSidePanelServices();
  beforeAll(() => {
    initFakeSidePanelServices(services);
  });

  beforeEach(() => {
    services.chats.listChatSummaries = async () => [];
    services.chat.openChat = async () => false;
    services.chat.discardIfDeleted = async () => undefined;
    services.chats.deleteChat = async () => undefined;
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no chats", async () => {
    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    expect(await screen.findByText("No chats yet")).toBeInTheDocument();
  });

  it("shows 'Loading…' before the list resolves, then the loaded list", async () => {
    let resolveList!: (value: ChatSummary[]) => void;
    services.chats.listChatSummaries = () =>
      new Promise((resolve) => {
        resolveList = resolve;
      });

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    resolveList([summary({ preview: "hi there" })]);
    expect(await screen.findByText("hi there")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("renders a row per chat summary", async () => {
    services.chats.listChatSummaries = async () => [
      summary({ id: "a", preview: "first chat" }),
      summary({ id: "b", preview: "second chat" }),
    ];
    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });

    expect(await screen.findByText("first chat")).toBeInTheDocument();
    expect(screen.getByText("second chat")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens a chat and calls onOpenChat when openChat succeeds", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hi there" })];
    const openChat = vi.fn(async () => true);
    services.chat.openChat = openChat;
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(await screen.findByRole("button", { name: /hi there/ }));

    expect(openChat).toHaveBeenCalledWith("chat-1");
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledTimes(1));
  });

  it("does not call onOpenChat when openChat resolves false", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hi there" })];
    services.chat.openChat = async () => false;
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(await screen.findByRole("button", { name: /hi there/ }));

    await waitFor(() => expect(services.chat.openChat).toBeTruthy());
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("delete stops propagation: does not open the chat", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hi there" })];
    const openChat = vi.fn(async () => true);
    services.chat.openChat = openChat;
    const deleteChat = vi.fn(async () => undefined);
    services.chats.deleteChat = deleteChat;
    const discardIfDeleted = vi.fn(async () => undefined);
    services.chat.discardIfDeleted = discardIfDeleted;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(await screen.findByRole("button", { name: /Delete chat from/ }));

    await waitFor(() => expect(deleteChat).toHaveBeenCalledWith("chat-1"));
    expect(discardIfDeleted).toHaveBeenCalledWith("chat-1");
    expect(openChat).not.toHaveBeenCalled();
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("does not delete when the confirm dialog is declined", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hi there" })];
    const deleteChat = vi.fn(async () => undefined);
    services.chats.deleteChat = deleteChat;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    await user.click(await screen.findByRole("button", { name: /Delete chat from/ }));

    // Give any (incorrect) async delete a tick to happen before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(deleteChat).not.toHaveBeenCalled();
  });
});
