// Card 84 (decisions/30-vitest-test-pyramid.md). OverflowMenu.svelte reads
// `chat()`/`sidePanelServices()` (app-services) directly, plus the
// read-only `panel` store — MOCKED WHOLESALE here (card 116's export
// feature is the first thing in this file that needs `panel.messages`/
// `activeChatTitle`/`activeChatOrigin` to be something other than empty),
// the same `vi.hoisted` state + `vi.mock` pattern ModelPicker.test.ts
// already uses for the same store. `state.activeChatId` defaults to
// `undefined` and `state.messages` to `[]`, matching what the REAL store
// reports before any chat has ever been opened — every pre-existing test
// below ran against exactly that before this mock existed, so none of them
// needed to change.
import "@testing-library/svelte/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import {
  createFakeSidePanelServices,
  initFakeSidePanelServices,
  storageFailure,
} from "../testing/fake-services";
import { fail, ok } from "../../domain/result";
import type { ChatSummary, TranscriptEntry } from "../../domain/chat";
import type { ConnectionStatus } from "../stores/panel.svelte";
import { m } from "../../paraglide/messages.js";

const panelState = vi.hoisted(() => ({
  activeChatId: undefined as string | undefined,
  activeChatTitle: undefined as string | undefined,
  activeChatOrigin: undefined as string | undefined,
  messages: [] as TranscriptEntry[],
}));

vi.mock("../stores/panel.svelte", () => ({
  panel: {
    get activeChatId() {
      return panelState.activeChatId;
    },
    get activeChatTitle() {
      return panelState.activeChatTitle;
    },
    get activeChatOrigin() {
      return panelState.activeChatOrigin;
    },
    get messages() {
      return panelState.messages;
    },
  },
}));

// Card 116: the export handler's two side effects — OverflowMenu.svelte
// calls these directly (not through app-services), so they're mocked here
// the same way the panel store is, and asserted on rather than re-verified:
// src/ui/download.test.ts and the (none needed — a one-liner) clipboard
// wrapper already cover what each one does on its own.
vi.mock("../../ui/clipboard", () => ({
  copyText: vi.fn(async () => true),
}));
vi.mock("../../ui/download", () => ({
  downloadTextFile: vi.fn(),
}));

// `vi.mock` calls above are hoisted by Vitest above every import in this
// file (the same behaviour ModelPicker.test.ts relies on), so these ordinary
// imports already resolve against the mocks.
import OverflowMenu from "./OverflowMenu.svelte";
import { copyText } from "../../ui/clipboard";
import { downloadTextFile } from "../../ui/download";

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
  await user.click(screen.getByRole("button", { name: m.overflowMenu_moreOptionsLabel() }));
  return user;
}

describe("OverflowMenu", () => {
  const services = createFakeSidePanelServices();
  beforeAll(() => {
    initFakeSidePanelServices(services);
  });

  beforeEach(() => {
    services.chats.listChatSummaries = async () => ok([]);
    services.chat.openChat = async () => ok(false);
    services.shell.openOptionsPage = vi.fn();
    panelState.activeChatId = undefined;
    panelState.activeChatTitle = undefined;
    panelState.activeChatOrigin = undefined;
    panelState.messages = [];
    vi.mocked(copyText).mockClear();
    vi.mocked(downloadTextFile).mockClear();
  });

  // bits-ui's DropdownMenu sets `document.body.style.pointerEvents = "none"`
  // while open (a dismissable-layer guard against interacting with anything
  // behind it) and only reverts it on its own close transition. A test that
  // unmounts (via `@testing-library/svelte/vitest`'s auto-cleanup) without
  // ever closing the menu first leaves that style on `body`, which then
  // blocks `userEvent`'s pointer-events check on the NEXT test's trigger
  // button — confirmed by reproduction while writing this file. Reset it
  // directly rather than closing every menu by hand in every test.
  afterEach(async () => {
    // bits-ui's body-scroll-lock releases via a REAL setTimeout after the
    // dropdown unmounts. On a fast machine it fires before this file's jsdom
    // is torn down; on CI's slower runner it fired AFTER, and `document is
    // not defined` inside that timer failed the whole run as an unhandled
    // error (v0.5.0's first tag pipeline). Unmount now and wait for the
    // release to have actually run before the test ends, so no timer can
    // outlive the environment. Polling, not a fixed sleep — card 125 found
    // 50ms sleeps still flaky for this exact lock.
    cleanup();
    await waitFor(() => {
      if (document.body.style.pointerEvents === "none") {
        throw new Error("bits-ui scroll lock not yet released");
      }
    });
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
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hello world" })]);
    renderMenu();
    await openMenu();

    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  it("shows 'No chats yet.' when there are none", async () => {
    renderMenu();
    await openMenu();

    expect(await screen.findByText(m.overflowMenu_noChatsMessage())).toBeInTheDocument();
  });

  it("only lists the first 5 chats, with a More row for the rest", async () => {
    services.chats.listChatSummaries = async () =>
      ok(Array.from({ length: 7 }, (_, i) => summary({ id: `c${i}`, preview: `chat ${i}` })));
    renderMenu();
    await openMenu();

    expect(await screen.findByText("chat 0")).toBeInTheDocument();
    expect(screen.getByText("chat 4")).toBeInTheDocument();
    expect(screen.queryByText("chat 5")).not.toBeInTheDocument();
    expect(screen.getByText(m.overflowMenu_moreLabel())).toBeInTheDocument();
  });

  it("opens a recent chat and calls onOpenChat only when openChat succeeds", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hello world" })]);
    const openChat = vi.fn(async () => ok(true));
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

  it("does not call onOpenChat when openChat resolves ok(false)", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hello world" })]);
    services.chat.openChat = async () => ok(false);
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
      ok(Array.from({ length: 6 }, (_, i) => summary({ id: `c${i}`, preview: `chat ${i}` })));
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

    await user.click(await screen.findByText(m.overflowMenu_moreLabel()));
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

    await user.click(await screen.findByText(m.overflowMenu_toolsCallLogLabel()));
    expect(onOpenTools).toHaveBeenCalledTimes(1);
  });

  it("Open options calls the fake shell's openOptionsPage", async () => {
    renderMenu();
    const user = await openMenu();

    await user.click(await screen.findByText(m.openOptionsAction()));

    expect(services.shell.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("renders the connection status label", async () => {
    renderMenu("error");
    await openMenu();

    expect(await screen.findByText(m.connectionStatus_error())).toBeInTheDocument();
  });

  it("renders 'Connected' for connectionStatus 'connected'", async () => {
    renderMenu("connected");
    await openMenu();

    expect(await screen.findByText(m.connectionStatus_connected())).toBeInTheDocument();
  });

  // Card 92: `handleOpenChange` (OverflowMenu.svelte) gets a `Result` back
  // from `listChatSummaries` rather than a rejecting promise, and on `err`
  // `summaries` is left untouched — matching the same
  // "don't blank what's already on screen" posture HistoryPanel.test.ts
  // covers for the full history view. First open succeeds and populates the
  // recent list; the menu is then closed and reopened with a FAILING read, so
  // the second open is the one that must leave the first open's list in
  // place rather than clearing it to "No chats yet.".
  // Card 95 replaces that log with the menu's own one-line state: a
  // shortcut list that could not be refreshed says so where the user is
  // standing, and "More" (which reports properly) is one row below.
  it("keeps the previously-loaded recent list and says so when a later open's storage read fails", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hello world" })]);
    const user = userEvent.setup();

    renderMenu();
    await user.click(screen.getByRole("button", { name: m.overflowMenu_moreOptionsLabel() }));
    expect(await screen.findByText("hello world")).toBeInTheDocument();

    // Close, then swap the fake to a failing read before opening again. As
    // this file's own `afterEach` documents, bits-ui's DropdownMenu leaves
    // `body`'s `pointer-events: none` guard in place until ITS OWN close
    // transition runs — which jsdom never does — so a same-test reopen has
    // to clear that style by hand, exactly as `afterEach` does between tests.
    await user.keyboard("{Escape}");
    document.body.style.pointerEvents = "";
    const err = storageFailure();
    services.chats.listChatSummaries = async () => fail(err);

    await user.click(screen.getByRole("button", { name: m.overflowMenu_moreOptionsLabel() }));

    // The recent list from the first, successful open is still showing —
    // the failed re-fetch did not blank it.
    expect(await screen.findByText("hello world")).toBeInTheDocument();
    expect(screen.queryByText(m.overflowMenu_noChatsMessage())).not.toBeInTheDocument();
    expect(await screen.findByText(m.overflowMenu_loadFailedMessage())).toBeInTheDocument();
  });

  // Card 95: an unreadable store and a chat that is simply gone are
  // different facts, but not to this menu — it has nothing to switch to
  // either way, and the full History view is where the reason belongs.
  it("does not switch views when openChat fails outright", async () => {
    services.chats.listChatSummaries = async () => ok([summary({ preview: "hello world" })]);
    services.chat.openChat = async () => fail(storageFailure());
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

  // --------------------------------------------------------------------
  // Card 116: "Export as Markdown" — the ACTIVE chat (`panel`, mocked
  // above), never a row from the recent-chats list.
  // --------------------------------------------------------------------

  function exportMenuItem(): HTMLElement {
    const label = screen.getByText(m.overflowMenu_exportMarkdownLabel());
    const item = label.closest("[data-dropdown-menu-item]");
    if (!(item instanceof HTMLElement)) throw new Error("export menu item not found");
    return item;
  }

  it("is disabled with no active chat, and clicking it does nothing", async () => {
    renderMenu();
    await openMenu();

    expect(exportMenuItem()).toHaveAttribute("aria-disabled", "true");

    await userEvent.setup().click(exportMenuItem());
    expect(copyText).not.toHaveBeenCalled();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it("copies and downloads the active chat as Markdown, titled and named from it", async () => {
    panelState.activeChatTitle = "My ferret questions";
    panelState.activeChatOrigin = "https://example.com";
    panelState.messages = [{ id: "u1", role: "user", content: "hello there", createdAt: 0 }];
    renderMenu();
    const user = await openMenu();

    await user.click(exportMenuItem());

    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    const markdown = vi.mocked(copyText).mock.calls[0]?.[0];
    expect(markdown).toContain("# My ferret questions");
    expect(markdown).toContain("https://example.com");
    expect(markdown).toContain("hello there");

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    expect(downloadTextFile).toHaveBeenCalledWith("My-ferret-questions.md", markdown);
  });

  it("derives the title from the first message when the chat has no explicit title", async () => {
    panelState.messages = [
      { id: "u1", role: "user", content: "what do ferrets eat", createdAt: 0 },
    ];
    renderMenu();
    const user = await openMenu();

    await user.click(exportMenuItem());

    await waitFor(() => expect(downloadTextFile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadTextFile).mock.calls[0]?.[0]).toBe("what-do-ferrets-eat.md");
  });
});
