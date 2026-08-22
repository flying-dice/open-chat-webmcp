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
import {
  createFakeSidePanelServices,
  initFakeSidePanelServices,
  storageFailure,
} from "../testing/fake-services";
import { fail, ok } from "../../domain/result";
import type { ChatSummary } from "../../domain/chat";
import { isolateLtr } from "../../ui/bidi";

// jsdom has no ResizeObserver. HistoryPanel wraps its list in shadcn-svelte's
// ScrollArea (bits-ui), which observes its content node to decide whether to
// show a scrollbar — irrelevant to anything this file asserts, but its
// `$effect` throws immediately on mount without this stub.
import "../../ui/testing/resize-observer";
import { m } from "../../paraglide/messages.js";

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
    services.chats.listChatSummaries = async () => ok([]);
    services.chat.openChat = async () => ok(false);
    services.chat.discardIfDeleted = async () => ok();
    services.chats.deleteChat = async () => ok();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no chats", async () => {
    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    expect(await screen.findByText(m.historyPanel_emptyTitle())).toBeInTheDocument();
  });

  it("shows 'Loading…' before the list resolves, then the loaded list", async () => {
    let resolveList!: (result: ReturnType<typeof ok<ChatSummary[]>>) => void;
    services.chats.listChatSummaries = () =>
      new Promise((resolve) => {
        resolveList = resolve;
      });

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    expect(screen.getByText(m.historyPanel_loading())).toBeInTheDocument();

    resolveList(ok([summary({ preview: "hi there" })]));
    expect(await screen.findByText("hi there")).toBeInTheDocument();
    expect(screen.queryByText(m.historyPanel_loading())).not.toBeInTheDocument();
  });

  it("renders a row per chat summary", async () => {
    services.chats.listChatSummaries = async () =>
      ok([
        summary({ id: "a", preview: "first chat" }),
        summary({ id: "b", preview: "second chat" }),
      ]);
    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });

    expect(await screen.findByText("first chat")).toBeInTheDocument();
    expect(screen.getByText("second chat")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens a chat and calls onOpenChat when openChat succeeds", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    const openChat = vi.fn(async () => ok(true));
    services.chat.openChat = openChat;
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(await screen.findByRole("button", { name: /hi there/ }));

    expect(openChat).toHaveBeenCalledWith("chat-1");
    await waitFor(() => expect(onOpenChat).toHaveBeenCalledTimes(1));
  });

  it("does not call onOpenChat when openChat resolves ok(false) — the chat is simply gone", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    services.chat.openChat = async () => ok(false);
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(await screen.findByRole("button", { name: /hi there/ }));

    await waitFor(() => expect(services.chat.openChat).toBeTruthy());
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("delete stops propagation: does not open the chat", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    const openChat = vi.fn(async () => ok(true));
    services.chat.openChat = openChat;
    const deleteChat = vi.fn(async () => ok());
    services.chats.deleteChat = deleteChat;
    const discardIfDeleted = vi.fn(async () => ok());
    services.chat.discardIfDeleted = discardIfDeleted;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(m.historyListItem_deleteLabel({ origin: "" })),
      }),
    );

    await waitFor(() => expect(deleteChat).toHaveBeenCalledWith("chat-1"));
    expect(discardIfDeleted).toHaveBeenCalledWith("chat-1");
    expect(openChat).not.toHaveBeenCalled();
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("does not delete when the confirm dialog is declined", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    const deleteChat = vi.fn(async () => ok());
    services.chats.deleteChat = deleteChat;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(m.historyListItem_deleteLabel({ origin: "" })),
      }),
    );

    // Give any (incorrect) async delete a tick to happen before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(deleteChat).not.toHaveBeenCalled();
  });

  // Card 92: `refresh()` (HistoryPanel.svelte) now gets a `Result` back from
  // `listChatSummaries` rather than a rejecting promise, and on `err` it
  // returns WITHOUT touching `summaries` — the list that was already on
  // screen stays exactly as it was, rather than the effect's `status` flip
  // dropping through to the empty state. Card 95 adds the second half of the
  // assertion: the reason is now ON SCREEN, above the preserved list, rather
  // than in a console nobody has open. `handleDelete` calls `refresh()`
  // again after its own delete completes, which is the one place within a
  // single mount this second, later-failing read can happen — the initial
  // mount's `listChatSummaries` succeeds first so there is something on
  // screen to preserve, then it is swapped to a failing implementation for
  // the read `handleDelete` triggers.
  it("keeps the previous list, and logs, when a later refresh's storage read fails", async () => {
    services.chats.listChatSummaries = async () =>
      ok([
        summary({ id: "a", origin: "https://a.example.com", preview: "first chat" }),
        summary({ id: "b", origin: "https://b.example.com", preview: "second chat" }),
      ]);
    const deleteChat = vi.fn(async () => ok());
    services.chats.deleteChat = deleteChat;
    services.chat.discardIfDeleted = vi.fn(async () => ok());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    expect(await screen.findByText("first chat")).toBeInTheDocument();
    expect(screen.getByText("second chat")).toBeInTheDocument();

    // From here on, any further listing read fails — exactly what
    // `handleDelete`'s own `refresh()` call is about to trigger.
    const err = storageFailure();
    services.chats.listChatSummaries = async () => fail(err);

    await user.click(
      await screen.findByRole("button", {
        name: m.historyListItem_deleteLabel({ origin: isolateLtr("https://a.example.com") }),
      }),
    );
    await waitFor(() => expect(deleteChat).toHaveBeenCalledWith("a"));

    // The list was NOT blanked to the "No chats yet" empty state — both
    // previously-loaded summaries are still exactly where they were.
    expect(screen.getByText("first chat")).toBeInTheDocument();
    expect(screen.getByText("second chat")).toBeInTheDocument();
    expect(screen.queryByText("No chats yet")).not.toBeInTheDocument();
    expect(
      await screen.findByText(new RegExp(m.historyPanel_loadFailedWhat())),
    ).toBeInTheDocument();
  });

  // --------------------------------------------------------------------
  // Card 95: the two `openChat`/`deleteChat` failure paths, on screen
  // --------------------------------------------------------------------

  it("shows why a chat could not be opened, and stays on the list", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    services.chat.openChat = async () => fail(storageFailure());
    const onOpenChat = vi.fn();
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat } });
    await user.click(await screen.findByRole("button", { name: /hi there/ }));

    expect(
      await screen.findByText(new RegExp(m.historyPanel_openFailedWhat())),
    ).toBeInTheDocument();
    // The view does not switch: the service writes the tab pointer before it
    // swaps the visible chat, so nothing changed and there is nothing to
    // switch to.
    expect(onOpenChat).not.toHaveBeenCalled();
    // The row it failed on is still listed.
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("shows why a chat could not be deleted, and keeps the row", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    const discardIfDeleted = vi.fn(async () => ok());
    services.chat.discardIfDeleted = discardIfDeleted;
    services.chats.deleteChat = async () => fail(storageFailure());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(m.historyListItem_deleteLabel({ origin: "" })),
      }),
    );

    expect(
      await screen.findByText(new RegExp(m.historyPanel_deleteFailedWhat())),
    ).toBeInTheDocument();
    // Card 92's rule, still pinned: no fresh-chat swap follows a delete that
    // did not land.
    expect(discardIfDeleted).not.toHaveBeenCalled();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("reports a delete that landed but left the tab pointing at the deleted chat", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hi there" })]);
    services.chats.deleteChat = async () => ok();
    services.chat.discardIfDeleted = async () => fail(storageFailure());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(HistoryPanel, { props: { onOpenChat: vi.fn() } });
    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(m.historyListItem_deleteLabel({ origin: "" })),
      }),
    );

    expect(
      await screen.findByText(new RegExp(m.historyPanel_discardFailedWhat())),
    ).toBeInTheDocument();
  });
});
