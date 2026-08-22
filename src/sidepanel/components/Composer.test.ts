// Component tests for Composer.svelte (card 84 checklist: "Enter sends /
// Shift+Enter newline / IME composition guard, send↔stop swap by turn
// state, disabled logic, blocked-state messaging").
//
// Composer.svelte reads `selection`/`openPicker`/`openOptionsPage` from
// ../stores/selection.svelte — a module-singleton store, not app-services
// directly. Testing this through the REAL store would mean recreating its
// own async orchestration (syncToTab's provider loading, etc.), which
// belongs to that store's own tests, not this component's. So the module is
// mocked directly: `state` (a plain, non-reactive object) backs the mocked
// getters, and each test sets it to the shape it wants before rendering.
// Since `blocked` (Composer's internal $derived.by) is only read once per
// mount here, setting `state` and calling `render()` fresh per test is
// enough — no reactive updates are needed within a single test.
//
// `vi.resetModules()` is deliberately never used here — confirmed elsewhere
// in this codebase's session history to corrupt Svelte's internal module
// state when combined with a bits-ui component mounted afterward. Plain
// `vi.mock` + static imports only.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import type { ProviderConfig, SelectionResolution } from "../../domain/providers";

const state = vi.hoisted(() => ({
  resolution: {
    status: "ok",
    config: { id: "p1", type: "ollama", name: "Local", baseUrl: "http://localhost:11434" },
    model: "llama3.1",
  },
  providersStatus: "loaded" as "loading" | "loaded" | "error",
  providers: [{ id: "p1" }] as ProviderConfig[],
  needsConfirmation: false,
})) as {
  resolution: SelectionResolution;
  providersStatus: "loading" | "loaded" | "error";
  providers: ProviderConfig[];
  needsConfirmation: boolean;
};

vi.mock("../stores/selection.svelte", () => ({
  selection: {
    get providers() {
      return state.providers;
    },
    get providersStatus() {
      return state.providersStatus;
    },
    get resolution() {
      return state.resolution;
    },
    get needsConfirmation() {
      return state.needsConfirmation;
    },
  },
  openPicker: vi.fn(),
  openOptionsPage: vi.fn(),
}));

// jsdom has no ResizeObserver. IconButton wraps its icon in a bits-ui
// Tooltip, whose floating layer observes its anchor's size — irrelevant to
// anything asserted here, but constructing it throws without this stub.
import "../../ui/testing/resize-observer";
import Composer from "./Composer.svelte";
import { openPicker, openOptionsPage } from "../stores/selection.svelte";

function resetToBaseline(): void {
  state.providersStatus = "loaded";
  state.providers = [
    { id: "p1", type: "ollama", name: "Local", baseUrl: "http://localhost:11434" },
  ];
  state.resolution = {
    status: "ok",
    config: { id: "p1", type: "ollama", name: "Local", baseUrl: "http://localhost:11434" },
    model: "llama3.1",
  } as SelectionResolution;
  state.needsConfirmation = false;
}

describe("Composer", () => {
  beforeEach(() => {
    resetToBaseline();
    vi.clearAllMocks();
  });

  // @testing-library/svelte's cleanup is not auto-registered here — this
  // project doesn't set `test.globals: true` (vitest.config.ts), so the
  // library never sees a global `afterEach` to hook itself onto. Without
  // this, every render() in a later test piles its DOM on top of the last
  // one instead of replacing it.
  afterEach(() => {
    cleanup();
  });

  describe("sending", () => {
    it("sends trimmed text on Enter and clears the textarea", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(Composer, { busy: false, onSend, onStop: vi.fn() });

      const textbox = screen.getByRole("textbox", { name: "Message" });
      await user.type(textbox, "  hello there  {Enter}");

      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith("hello there");
      expect(textbox).toHaveValue("");
    });

    it("inserts a newline on Shift+Enter and does not send", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(Composer, { busy: false, onSend, onStop: vi.fn() });

      const textbox = screen.getByRole("textbox", { name: "Message" });
      await user.type(textbox, "line1{Shift>}{Enter}{/Shift}line2");

      expect(onSend).not.toHaveBeenCalled();
      // jest-dom's toHaveValue doesn't support asymmetric matchers (e.g.
      // expect.stringContaining) — assert the exact value instead, which is
      // the stronger check anyway and still proves a "\n" landed in it.
      expect(textbox).toHaveValue("line1\nline2");
    });

    it("does not send on Enter while IME composition is in progress", async () => {
      const onSend = vi.fn();
      render(Composer, { busy: false, onSend, onStop: vi.fn() });

      const textbox = screen.getByRole("textbox", { name: "Message" });
      // user-event doesn't model isComposing well, so this one case uses
      // fireEvent.keyDown directly rather than userEvent.type/keyboard.
      await fireEvent.keyDown(textbox, { key: "Enter", isComposing: true });

      expect(onSend).not.toHaveBeenCalled();
    });

    it("keeps Send disabled with an empty textarea", () => {
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });

    it("keeps Send disabled when the textarea holds only whitespace", async () => {
      const user = userEvent.setup();
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      const textbox = screen.getByRole("textbox", { name: "Message" });
      await user.type(textbox, "   ");

      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });

    it("never sends on Enter when the textarea is empty or whitespace-only", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(Composer, { busy: false, onSend, onStop: vi.fn() });

      const textbox = screen.getByRole("textbox", { name: "Message" });
      await user.type(textbox, "{Enter}");
      await user.type(textbox, "   {Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("send/stop swap by turn state", () => {
    it("renders a Send button when not busy", () => {
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stop generating" })).not.toBeInTheDocument();
    });

    it("renders a disabled Stop generating button when busy, calling onStop, and disables the textarea", async () => {
      const user = userEvent.setup();
      const onStop = vi.fn();
      render(Composer, { busy: true, onSend: vi.fn(), onStop });

      expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
      const stopButton = screen.getByRole("button", { name: "Stop generating" });
      expect(stopButton).toBeInTheDocument();

      await user.click(stopButton);
      expect(onStop).toHaveBeenCalledTimes(1);

      expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    });
  });

  describe("blocked-state messaging", () => {
    it("shows a loading message and no textarea while providers are loading", () => {
      state.providersStatus = "loading";
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      expect(screen.getByText("Loading providers…")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    });

    it("shows a provider-load error with an Open options action", async () => {
      const user = userEvent.setup();
      state.providersStatus = "error";
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      expect(screen.getByText("Couldn't load your providers.")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Open options" });
      await user.click(button);
      expect(openOptionsPage).toHaveBeenCalledTimes(1);
    });

    it("shows a no-providers-registered message with an Open options action", async () => {
      const user = userEvent.setup();
      state.providersStatus = "loaded";
      state.providers = [];
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      expect(
        screen.getByText(
          "No provider is registered yet — add one on the options page to start chatting.",
        ),
      ).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Open options to add a provider" });
      await user.click(button);
      expect(openOptionsPage).toHaveBeenCalledTimes(1);
    });

    it("shows an unselected message with a Choose provider & model action when resolution is none", async () => {
      const user = userEvent.setup();
      state.resolution = { status: "none" };
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      expect(
        screen.getByText("Choose a provider and model before sending your first message."),
      ).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Choose provider & model" });
      await user.click(button);
      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it("shows the dangling-provider copy with the same Choose provider & model action", async () => {
      const user = userEvent.setup();
      state.resolution = { status: "dangling", providerId: "p1", model: "m1" };
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      // getByText's default matcher normalizes whitespace, so the source's
      // multi-line template text (indentation and all) matches this plain
      // single-line string with no custom matcher needed.
      expect(
        screen.getByText(
          "The provider this chat was using has been removed. Choose a replacement to continue — your conversation is kept.",
        ),
      ).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Choose provider & model" });
      await user.click(button);
      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it("shows a needs-confirmation message naming the resolved provider/model", () => {
      state.resolution = {
        status: "ok",
        config: { id: "p1", type: "ollama", name: "Local", baseUrl: "http://localhost:11434" },
        model: "llama3.1",
      };
      state.needsConfirmation = true;
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      // The model name/id sits in a nested <strong>, and getByText's default
      // matcher only ever looks at an element's OWN text-node children (see
      // @testing-library/dom's getNodeText), never its descendants' text —
      // so a plain string can't span across the <strong> boundary here. A
      // custom matcher against the <p>'s full (recursive) textContent does,
      // scoped to `selector: "p"` so the ancestor <div>/<form>, whose
      // recursive textContent is identical since the <p> is their only
      // child, don't also match and trip a multiple-elements error.
      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent?.replace(/\s+/g, " ").trim() ===
            "This chat will use Local · llama3.1 — confirm it below to start.",
          { selector: "p" },
        ),
      ).toBeInTheDocument();
    });

    it("renders the normal textarea + Send button in the not-blocked baseline", () => {
      render(Composer, { busy: false, onSend: vi.fn(), onStop: vi.fn() });

      expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
      expect(screen.queryByText("Loading providers…")).not.toBeInTheDocument();
    });

    it("never blocks mid-turn, even when the selection state would otherwise block", () => {
      state.providersStatus = "error";
      render(Composer, { busy: true, onSend: vi.fn(), onStop: vi.fn() });

      expect(screen.queryByText("Couldn't load your providers.")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    });
  });
});
