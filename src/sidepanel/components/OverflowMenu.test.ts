// Card 84 (decisions/30-vitest-test-pyramid.md). OverflowMenu.svelte reads
// `chat()`/`sidePanelServices()` (app-services) directly, plus the
// read-only `panel` store (never initialised beyond app-services — its
// `activeChatId` getter reads a private module variable this test cannot
// drive, so no assertion here depends on it). Driven through
// src/sidepanel/testing/fake-services.ts's fake bundle, initialised ONCE per
// file — see that helper's header comment for why never `vi.resetModules()`.
import "@testing-library/svelte/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import OverflowMenu from "./OverflowMenu.svelte";
import { createFakeSidePanelServices, initFakeSidePanelServices } from "../testing/fake-services";
import type { ChatSummary } from "../../domain/chat";
import type { ConnectionStatus } from "../stores/panel.svelte";

function summary(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: "chat-1",
    origin: "https://example.com",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    toolCallCount: 0,
    preview: "hello world",
    ...overrides,
  };
}

async function openMenu(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options" }));
  return user;
}

describe("OverflowMenu", () => {
  const services = createFakeSidePanelServices();
  beforeAll(() => {
    initFakeSidePanelServices(services);
  });

  beforeEach(() => {
    services.chats.listChatSummaries = async () => [];
    services.chat.openChat = async () => false;
    services.shell.openOptionsPage = vi.fn();
  });

  // bits-ui's DropdownMenu sets `document.body.style.pointerEvents = "none"`
  // while open (a dismissable-layer guard against interacting with anything
  // behind it) and only reverts it on its own close transition. A test that
  // unmounts (via `@testing-library/svelte/vitest`'s auto-cleanup) without
  // ever closing the menu first leaves that style on `body`, which then
  // blocks `userEvent`'s pointer-events check on the NEXT test's trigger
  // button — confirmed by reproduction while writing this file. Reset it
  // directly rather than closing every menu by hand in every test.
  afterEach(() => {
    document.body.style.pointerEvents = "";
  });

  function renderMenu(connectionStatus: ConnectionStatus = "connected") {
    return render(OverflowMenu, {
      props: {
        onOpenHistory: vi.fn(),
        onOpenTools: vi.fn(),
        onOpenChat: vi.fn(),
        connectionStatus,
      },
    });
  }

  it("lists recent chats loaded from the fake chats port on open", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hello world" })];
    renderMenu();
    await openMenu();

    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  it("shows 'No chats yet.' when there are none", async () => {
    renderMenu();
    await openMenu();

    expect(await screen.findByText("No chats yet.")).toBeInTheDocument();
  });

  it("only lists the first 5 chats, with a More row for the rest", async () => {
    services.chats.listChatSummaries = async () =>
      Array.from({ length: 7 }, (_, i) => summary({ id: `c${i}`, preview: `chat ${i}` }));
    renderMenu();
    await openMenu();

    expect(await screen.findByText("chat 0")).toBeInTheDocument();
    expect(screen.getByText("chat 4")).toBeInTheDocument();
    expect(screen.queryByText("chat 5")).not.toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
  });

  it("opens a recent chat and calls onOpenChat only when openChat succeeds", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hello world" })];
    const openChat = vi.fn(async () => true);
    services.chat.openChat = openChat;
    const onOpenChat = vi.fn();
    render(OverflowMenu, {
      props: {
        onOpenHistory: vi.fn(),
        onOpenTools: vi.fn(),
        onOpenChat,
        connectionStatus: "connected",
      },
    });
    const user = await openMenu();

    await user.click(await screen.findByText("hello world"));

    expect(openChat).toHaveBeenCalledWith("chat-1");
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it("does not call onOpenChat when openChat resolves false", async () => {
    services.chats.listChatSummaries = async () => [summary({ preview: "hello world" })];
    services.chat.openChat = async () => false;
    const onOpenChat = vi.fn();
    render(OverflowMenu, {
      props: {
        onOpenHistory: vi.fn(),
        onOpenTools: vi.fn(),
        onOpenChat,
        connectionStatus: "connected",
      },
    });
    const user = await openMenu();

    await user.click(await screen.findByText("hello world"));

    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("More calls onOpenHistory", async () => {
    services.chats.listChatSummaries = async () =>
      Array.from({ length: 6 }, (_, i) => summary({ id: `c${i}`, preview: `chat ${i}` }));
    const onOpenHistory = vi.fn();
    render(OverflowMenu, {
      props: {
        onOpenHistory,
        onOpenTools: vi.fn(),
        onOpenChat: vi.fn(),
        connectionStatus: "connected",
      },
    });
    const user = await openMenu();

    await user.click(await screen.findByText("More"));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("Tools & call log calls onOpenTools", async () => {
    const onOpenTools = vi.fn();
    render(OverflowMenu, {
      props: {
        onOpenHistory: vi.fn(),
        onOpenTools,
        onOpenChat: vi.fn(),
        connectionStatus: "connected",
      },
    });
    const user = await openMenu();

    await user.click(await screen.findByText("Tools & call log"));
    expect(onOpenTools).toHaveBeenCalledTimes(1);
  });

  it("Open options calls the fake shell's openOptionsPage", async () => {
    renderMenu();
    const user = await openMenu();

    await user.click(await screen.findByText("Open options"));

    expect(services.shell.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("renders the connection status label", async () => {
    renderMenu("error");
    await openMenu();

    expect(await screen.findByText("Connection error")).toBeInTheDocument();
  });

  it("renders 'Connected' for connectionStatus 'connected'", async () => {
    renderMenu("connected");
    await openMenu();

    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});
