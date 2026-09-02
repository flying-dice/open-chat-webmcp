// Component coverage for ModelPicker.svelte (card 84). ModelPicker
// takes no props — every input arrives through the two module-singleton
// stores it imports, `../stores/selection.svelte` and `../stores/panel.svelte`,
// so both are mocked wholesale here rather than through their real
// app-services-backed implementations (see the module doc comments on
// selection.svelte.ts/panel.svelte.ts for what those stores actually do).
//
// `vi.hoisted` state backs plain getters standing in for `selection`'s
// reactive fields — read once per render, not truly reactive — which is why
// every case sets `state.*` (including `state.pickerOpen = true`, so
// Popover.Content actually mounts) BEFORE calling `render()`, never after.
//
// Deliberately no `vi.resetModules()` anywhere in this file: confirmed
// elsewhere in this codebase's session history to corrupt Svelte's internal
// module state and crash bits-ui components with "Cannot read properties of
// null (reading 'nodes')". Popover.Content is portalled into `document.body`
// (see src/ui/components/ui/popover/popover-portal.svelte) — Testing
// Library's `screen` queries the whole document, so that's transparent here.
// jsdom does not implement `Element.prototype.scrollIntoView` at all (not
// even as a no-op) — bits-ui's Command component calls it whenever the
// highlighted row changes, which otherwise surfaces as an unhandled
// rejection on every test that opens the popover. A per-file stub, not a
// vitest.setup.ts change (out of scope for this card).
Element.prototype.scrollIntoView = () => undefined;

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import type { ModelListEntry, ModelsState } from "../stores/selection.svelte";
import type { ModelCapabilities, ProviderConfig, ProviderModel } from "../../domain/providers";

const state = vi.hoisted(() => ({
  providers: [] as ProviderConfig[],
  providersStatus: "loaded" as "loading" | "loaded" | "error",
  resolution: { status: "none" } as
    | { status: "none" }
    | { status: "dangling" }
    | { status: "ok"; config: ProviderConfig; model: string },
  modelsByProvider: {} as Record<string, ModelsState>,
  needsConfirmation: false,
  pickerOpen: false,
}));

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
    get modelsByProvider() {
      return state.modelsByProvider;
    },
    get needsConfirmation() {
      return state.needsConfirmation;
    },
    get pickerOpen() {
      return state.pickerOpen;
    },
  },
  syncToTab: vi.fn(async () => undefined),
  selectModel: vi.fn(async () => undefined),
  enterManualModel: vi.fn(async () => undefined),
  reloadModels: vi.fn(),
  refresh: vi.fn(async () => undefined),
  openOptionsPage: vi.fn(),
  closePicker: vi.fn(),
  openPicker: vi.fn(),
}));

vi.mock("../stores/panel.svelte", () => ({
  panel: {
    get pageInfo() {
      return {
        tabId: 1,
        title: "Example",
        origin: "https://example.com",
        toolCount: 0,
        restricted: false,
        webmcpAvailable: true,
      };
    },
  },
}));

import { m } from "../../paraglide/messages.js";
import ModelPicker from "./ModelPicker.svelte";
import {
  selectModel,
  enterManualModel,
  reloadModels,
  closePicker,
} from "../stores/selection.svelte";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function provider(id: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    type: "ollama",
    name: `Provider ${id}`,
    baseUrl: `https://${id}.example.com`,
    ...overrides,
  };
}

function model(id: string, name = id): ProviderModel {
  return { id, name };
}

const TOOL_CAPABLE: ModelCapabilities = { status: "tool-capable" };
const NO_TOOLS: ModelCapabilities = {
  status: "no-tools",
  detail: ["No function-calling on this model."],
};
const UNKNOWN: ModelCapabilities = {
  status: "unknown",
  detail: ["Could not verify tool support."],
};

function entry(m: ProviderModel, capability: ModelCapabilities | undefined): ModelListEntry {
  return { model: m, capability };
}

function loaded(entries: ModelListEntry[]): ModelsState {
  return { status: "loaded", entries };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.providers = [];
  state.providersStatus = "loaded";
  state.resolution = { status: "none" };
  state.modelsByProvider = {};
  state.needsConfirmation = false;
  // Open by default so Popover.Content mounts and its rows are queryable —
  // most cases care about the content, not the closed trigger chip.
  state.pickerOpen = true;
});

// `@testing-library/svelte`'s auto-cleanup only self-registers when Vitest's
// `test.globals` is on (vitest.config.ts leaves it off, out of scope for
// this card) — without this, every `render()` after the first in a
// multi-`it()` file leaves the PREVIOUS test's DOM mounted alongside the
// new one, producing spurious "multiple elements found" failures.
afterEach(() => {
  cleanup();
});

/**
 * The popover's content region, scoped by the `aria-label="Choose a model"`
 * ModelPicker.svelte sets on it directly. Several of its status lines
 * ("Loading providers…", the empty-state sentence) repeat verbatim on the
 * trigger chip's own accessible name/title, so queries that care about the
 * CONTENT specifically (not just "this text exists somewhere on the page")
 * go through `within(await content())` rather than the unscoped `screen`.
 */
async function content(): Promise<HTMLElement> {
  return screen.findByLabelText(m.providerPicker_choosePopoverAriaLabel());
}

describe("ModelPicker", () => {
  // -------------------------------------------------------------------------
  it("shows a loading message while providers are loading", async () => {
    state.providersStatus = "loading";
    render(ModelPicker);

    // "Loading providers…" also appears as the trigger chip's own text/title
    // (`triggerInfo.label`) — scope to the content region so this asserts
    // the CONTENT's own loading line, not just that the phrase exists
    // somewhere on the page.
    const region = within(await content());
    expect(region.getByText(m.loadingProvidersLabel())).toBeInTheDocument();
  });

  it("shows an empty state with a link to options when no providers are registered", async () => {
    state.providers = [];
    state.providersStatus = "loaded";
    render(ModelPicker);

    const region = within(await content());
    expect(region.getByText(m.providerPicker_noProvidersMessage())).toBeInTheDocument();
    expect(
      region.getByRole("button", { name: m.providerPicker_openOptionsAddOneAction() }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  it("renders each provider as its own group heading with its models listed underneath", async () => {
    const a = provider("a", { name: "Alpha" });
    const b = provider("b", { name: "Beta" });
    state.providers = [a, b];
    state.modelsByProvider = {
      a: loaded([entry(model("llama3.1"), TOOL_CAPABLE)]),
      b: loaded([entry(model("mistral"), TOOL_CAPABLE)]),
    };

    render(ModelPicker);

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("llama3.1")).toBeInTheDocument();
    expect(screen.getByText("mistral")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Card 130 / decisions/43: the Unverified and No-tool-support sections
  // start collapsed behind a disclosure option stating their count, and
  // only render their rows once that option is activated (click or Enter —
  // review fix on card 130, MR !1 note 12450, deleted the Space-specific
  // handling this doc comment used to also list: `role="option"` in a
  // combobox+listbox doesn't require Space to activate, and the old Space
  // interception was swallowing ordinary filter typing).
  //
  // Review fix on card 130 (MR !1, note 12385): the disclosure is a real
  // `Command.Item` (`role="option"`), not a `<button>` or a custom widget —
  // see the doc comment on the `collapsibleOption` snippet in
  // ModelPicker.svelte for why: axe-core's `aria-required-children` flags
  // ANY `role="button"` (or any role besides `option`/`group`) descendant
  // of `Command.List`'s `role="listbox"`, at any nesting depth, and NEITHER
  // listbox-permitted role supports `aria-expanded` — there is no valid way
  // to put a formally "expanded" element in this tree at all. State is
  // therefore asserted via row presence/count (as most of these tests
  // already did), not an `aria-expanded` attribute — there isn't one.
  // `findByRole("option", ...)` finds it the same way `findByRole("button"/
  // "group", ...)` found the earlier markups.
  it("starts the Unverified section collapsed (toggle option shows the count, row absent) and reveals its row on click", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("mystery"), UNKNOWN)]) };

    render(ModelPicker);

    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (1)`,
    });
    expect(screen.queryByText("mystery")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByText("mystery")).toBeInTheDocument();
  });

  // Code-review fix on card 130: a filter query narrowing a collapsed
  // section down to a real match used to leave that match hidden behind the
  // still-collapsed heading — the count changed ("Unverified (9)" ->
  // "Unverified (1)") but the user had to notice that and click anyway.
  // Filtering should auto-expand a section with a nonzero filtered count,
  // and revert to collapsed once the filter clears again.
  it("auto-expands the Unverified section when a filter narrows it to a match, without an extra click", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    // Starts collapsed like every open (decisions/43) — past FILTER_THRESHOLD
    // (8), so the filter input is present too.
    await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (${names.length})`,
    });
    expect(screen.queryByText("gateway-model-7")).not.toBeInTheDocument();

    const filter = screen.getByLabelText(m.providerPicker_filterAriaLabel());
    await user.type(filter, "gateway-model-7");

    // The match is visible immediately once the filter narrows the section
    // to a nonzero count — no click on the toggle required. `getByText` +
    // `.closest`, not `findByRole(..., { name })`: typing into the filter
    // triggers a floating-ui reposition that jsdom's missing layout leaves
    // the popover's positioning wrapper stuck at inline `visibility:
    // hidden` — CSS `visibility` inherits, so `dom-accessibility-api`'s
    // name-from-content computation (which the toggle's accessible name
    // comes from — see the doc comment on `collapsibleOption` in
    // ModelPicker.svelte) treats every descendant's text as hidden and
    // returns an EMPTY accessible name for every option in the popover.
    // `getByText` matches literal `textContent`, unaffected by that.
    // Confirmed live in Storybook/Chromium (this card's gates require that)
    // that the toggle is genuinely reachable by role+name in a real browser.
    expect(
      (await screen.findByText(`${m.providerPicker_unverifiedHeading()} (1)`)).closest(
        '[role="option"]',
      ),
    ).not.toBeNull();
    expect(screen.getByText("gateway-model-7")).toBeInTheDocument();
    expect(screen.queryByText("gateway-model-1")).not.toBeInTheDocument();

    // Clearing the filter reverts to collapsed — the auto-expand was never a
    // manual toggle, so it doesn't stick once the query is gone.
    await user.clear(filter);

    expect(
      (
        await screen.findByText(`${m.providerPicker_unverifiedHeading()} (${names.length})`)
      ).closest('[role="option"]'),
    ).not.toBeNull();
    expect(screen.queryByText("gateway-model-7")).not.toBeInTheDocument();
  });

  // Review fix on card 130 (MR !1, note 12383): Enter on the disclosure
  // used to bubble to Command.Root, which owns Enter globally for "activate
  // the currently-highlighted row" — since the disclosure wasn't a
  // Command.Item, that committed whatever row WAS highlighted and closed
  // the whole popover instead of expanding the section. Now that the
  // disclosure IS a Command.Item, that same Command.Root mechanism is what
  // makes Enter work correctly: it activates the disclosure's own
  // `onSelect`. Measured live in Chromium via Playwright too (the card's
  // gates require that); this is the jsdom half, driven by a real keyboard
  // sequence rather than `user.click`.
  //
  // Command uses a roving/"virtual focus" highlight, not real per-row DOM
  // focus — real focus stays on the filter input (or `commandRootEl` when
  // there's no filter) the whole time, and arrow keys move a `[data-selected]`
  // marker instead. So this presses `{ArrowDown}` from the filter to
  // highlight the disclosure option, THEN Enter — not `heading.focus()`,
  // which doesn't reflect how this control is actually reached.
  //
  // Uses a dataset past FILTER_THRESHOLD (so the filter input mounts) and
  // waits for it to actually receive focus before pressing ArrowDown:
  // ModelPicker's own `handleOpenAutoFocus` resolves its `tick().then(...)`
  // ASYNCHRONOUSLY — later than `findByLabelText` resolves, since the
  // filter element is already in the DOM on the very first render and needs
  // no waiting itself. `waitFor` polls until that auto-focus has genuinely
  // landed.
  it("expands the Unverified section on Enter, keeping the popover open and committing nothing", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    await waitFor(() => expect(filter).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    expect(document.querySelector("[data-selected]")).toHaveAttribute(
      "data-value",
      "unverified-toggle",
    );

    await user.keyboard("{Enter}");

    // (a) the section expands
    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();
    // (b) the popover stays open — checked via the filter input rather than
    // the `content()` helper: with the default `resolution: "none"` state
    // this test uses, the trigger chip's accessible name and the popover's
    // own `aria-label` are BOTH literally "Choose a model"
    // (`providerPicker_chooseModelLabel`/`providerPicker_choosePopoverAriaLabel`
    // in messages/en.json), which makes `findByLabelText` ambiguous — a
    // pre-existing quirk of that helper no earlier test happened to exercise
    // under this resolution state, not something this fix introduced. The
    // filter input's own label doesn't collide, and its presence is exactly
    // as strong a proof the popover/Command tree is still mounted.
    expect(screen.getByLabelText(m.providerPicker_filterAriaLabel())).toBeInTheDocument();
    // (c) no row gets committed/selected
    expect(selectModel).not.toHaveBeenCalled();
    expect(closePicker).not.toHaveBeenCalled();
  });

  // Review fix on card 130 (MR !1, note 12449): the disclosure used to be a
  // one-way control — expanding it (registering ~9 newly-visible rows)
  // silently knocked bits-ui's own highlight off the toggle and onto
  // whatever sorted first (see `restoreDisclosureHighlight`'s doc comment in
  // ModelPicker.svelte), so a SECOND Enter landed on that row instead of
  // re-collapsing the section — committing a model and closing the popover.
  // This activates the toggle three times in a row (Enter, Enter, Enter) and
  // asserts every one of the properties the review measured live: the
  // section only ever expands/collapses, the popover never closes, and
  // neither `selectModel` nor `closePicker` is ever called.
  it("keeps the disclosure toggling on every Enter, never committing a model or closing the popover", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    await waitFor(() => expect(filter).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    expect(document.querySelector("[data-selected]")).toHaveAttribute(
      "data-value",
      "unverified-toggle",
    );

    // First Enter: expands.
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.querySelector("[data-selected]")).toHaveAttribute(
        "data-value",
        "unverified-toggle",
      ),
    );
    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();
    expect(screen.getByLabelText(m.providerPicker_filterAriaLabel())).toBeInTheDocument();
    // Review fix on card 130 (MR !1, note 12478) added a real-focus restore
    // alongside the highlight restore above, on the theory it fires
    // identically for every activation method. On the keyboard path focus
    // never left the filter in the first place, so this call must be a
    // true no-op here — pin that down explicitly so a future change can't
    // make Enter start moving focus away from the filter.
    expect(document.activeElement).toBe(filter);

    // Second Enter: re-collapses — the highlight must still be on the
    // toggle, not on whatever bits-ui sorted first after the expand.
    await user.keyboard("{Enter}");
    expect(screen.queryByText("gateway-model-1")).not.toBeInTheDocument();
    expect(screen.getByLabelText(m.providerPicker_filterAriaLabel())).toBeInTheDocument();
    expect(document.activeElement).toBe(filter);

    // Third Enter: re-expands again — a repeatable toggle, not a one-shot.
    await waitFor(() =>
      expect(document.querySelector("[data-selected]")).toHaveAttribute(
        "data-value",
        "unverified-toggle",
      ),
    );
    await user.keyboard("{Enter}");
    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();
    expect(screen.getByLabelText(m.providerPicker_filterAriaLabel())).toBeInTheDocument();
    expect(document.activeElement).toBe(filter);

    expect(selectModel).not.toHaveBeenCalled();
    expect(closePicker).not.toHaveBeenCalled();
  });

  // Same fix (note 12449), mouse half: click must round-trip the same way
  // Enter does — the highlight-restore logic in ModelPicker.svelte isn't
  // keyed off which input activated `onSelect`.
  it("keeps the disclosure toggling on every click, never committing a model or closing the popover", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());

    let toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (${names.length})`,
    });

    await user.click(toggle);
    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();
    // Review fix on card 130 (MR !1, note 12478): every click on the toggle
    // must leave real DOM focus on the filter, not just the roving
    // highlight — checked at every step of the full expand/collapse/expand
    // cycle, not only the first click.
    expect(document.activeElement).toBe(filter);

    toggle = (await screen.findByText(`${m.providerPicker_unverifiedHeading()} (9)`)).closest(
      '[role="option"]',
    ) as HTMLElement;
    await user.click(toggle);
    expect(screen.queryByText("gateway-model-1")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(filter);

    toggle = (await screen.findByText(`${m.providerPicker_unverifiedHeading()} (9)`)).closest(
      '[role="option"]',
    ) as HTMLElement;
    await user.click(toggle);
    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();
    expect(document.activeElement).toBe(filter);

    expect(selectModel).not.toHaveBeenCalled();
    expect(closePicker).not.toHaveBeenCalled();
  });

  // Review fix on card 130 (MR !1, note 12478): a click leaves real DOM
  // focus on `Command.List` (now a tab stop per note 12452's `tabindex={0}`)
  // instead of the filter input, so every subsequent keystroke was silently
  // discarded — no character in the box, no change to the list, no error.
  // Measured live in Chromium at head 0f1182b: `activeElement` after the
  // click was `command-list`, and typing "gate" afterward produced zero
  // change. This proves BOTH halves the review asked for measured together
  // in one assertion set (not separately, so a fix that restores one but not
  // the other can't slip through): the roving highlight AND real focus land
  // correctly from the SAME click, and a keystroke typed with no click on
  // the input actually reaches it and narrows the list.
  it("restores real focus to the filter input on a CLICK, so a keystroke with no click on the input still reaches the filter", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (${names.length})`,
    });

    await user.click(toggle);

    // Both halves, measured together: the highlight AND real focus.
    expect(document.querySelector("[data-selected]")).toHaveAttribute(
      "data-value",
      "unverified-toggle",
    );
    expect(document.activeElement).toBe(filter);

    // No click on the input anywhere in this test — type at whatever
    // currently holds focus, exactly the recovery path (or lack of one) the
    // review measured.
    await user.keyboard("gateway-model-5");
    expect(filter).toHaveValue("gateway-model-5");
    expect(screen.getByText("gateway-model-5")).toBeInTheDocument();
    expect(screen.queryByText("gateway-model-1")).not.toBeInTheDocument();
  });

  // Same fix, No-tool-support section: the restore isn't specific to the
  // Unverified toggle, so this proves it generalizes to the other
  // collapsible disclosure sharing the same `toggle` snippet
  // (`collapsibleOption` in ModelPicker.svelte).
  it("restores real focus to the filter input on a click on the No-tool-support toggle too", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `no-tools-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), NO_TOOLS))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_noToolSupportHeading()} (${names.length})`,
    });

    await user.click(toggle);

    expect(document.querySelector("[data-selected]")).toHaveAttribute(
      "data-value",
      "no-tools-toggle",
    );
    expect(document.activeElement).toBe(filter);

    await user.keyboard("no-tools-model-3");
    expect(filter).toHaveValue("no-tools-model-3");
    expect(screen.getByText("no-tools-model-3")).toBeInTheDocument();
    expect(screen.queryByText("no-tools-model-1")).not.toBeInTheDocument();
  });

  // CRITICAL EDGE CASE the review flagged: below FILTER_THRESHOLD (8) there
  // is no filter input at all (`showFilter` is false — see the "Grouped"
  // Storybook story, which renders none), so the restore must fall back to
  // `commandRootEl`, exactly like `handleOpenAutoFocus` already does on open.
  // A restore that assumed the filter input always exists (e.g.
  // `filterInputEl!.focus()`) would throw here instead of falling back.
  it("falls back to the Command root for focus restore when there is no filter input to restore to", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    // A single unverified model: 1 row total, well under FILTER_THRESHOLD
    // (8), so `showFilter` is false and no filter input mounts at all.
    state.modelsByProvider = { a: loaded([entry(model("mystery"), UNKNOWN)]) };

    render(ModelPicker);

    expect(screen.queryByLabelText(m.providerPicker_filterAriaLabel())).not.toBeInTheDocument();

    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (1)`,
    });
    await user.click(toggle);

    expect(screen.getByText("mystery")).toBeInTheDocument();
    const root = document.querySelector('[role="application"]');
    expect(root).not.toBeNull();
    expect(document.activeElement).toBe(root);
    expect(document.activeElement).not.toBe(document.body);
  });

  // Review fix on card 130 (MR !1, note 12491's re-review): this test's OWN
  // comment used to claim more than it could prove — "confirm scrollTop
  // doesn't reset" reads like a regression guard for the real bug, but jsdom
  // has NO layout engine at all: `scrollHeight`/`clientHeight` are always 0,
  // `scrollIntoView` is stubbed to a no-op above (jsdom doesn't implement it,
  // stubbed or not), and `list.scrollTop = 42` followed by reading `42` back
  // is just jsdom storing and returning a number — nothing here can lay out,
  // overflow, or scroll, so nothing here can reproduce note 12491's actual
  // defect (a real, layout-driven `scrollIntoView` call landing on the wrong
  // element while the highlight silently comes unstuck). A version of this
  // component that reverted to unconditionally zeroing `scrollTop` on every
  // toggle would still pass this test only by accident, not because it was
  // caught — jsdom would just as happily observe `list.scrollTop = 0` here.
  //
  // What this test genuinely proves, and no more: `restoreDisclosureHighlight`
  // does not itself contain a stray `scrollTop = 0` (or similar) write that a
  // jsdom-visible assertion COULD catch — a narrow but real regression guard,
  // kept for that reason. It does NOT prove the fix for note 12491's actual
  // finding (the scrollTop-preserving / stick-to-bottom logic in
  // `restoreDisclosureHighlight`, ModelPicker.svelte:~540) works. That proof
  // is a live Chromium measurement, recorded in board card 130's `## Comments`
  // journal, not a jsdom assertion — see the next test for what jsdom CAN
  // additionally prove (the highlight/focus half of the combined snapshot).
  it("does not disturb the scrollable list's own scroll position when restoring focus (narrow jsdom guard only — see comment above)", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const unverifiedNames = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    const noToolsNames = Array.from({ length: 9 }, (_, i) => `no-tools-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded([
        ...unverifiedNames.map((name) => entry(model(name), UNKNOWN)),
        ...noToolsNames.map((name) => entry(model(name), NO_TOOLS)),
      ]),
    };

    render(ModelPicker);

    const unverifiedToggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (${unverifiedNames.length})`,
    });
    await user.click(unverifiedToggle);
    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();

    const list = document.querySelector('[role="listbox"]') as HTMLElement;
    list.scrollTop = 42;

    // A DIFFERENT toggle's click also runs the same focus-restore — proving
    // the restore itself, not just "nothing happened yet", leaves scrollTop
    // alone.
    const noToolsToggle = (
      await screen.findByText(`${m.providerPicker_noToolSupportHeading()} (${noToolsNames.length})`)
    ).closest('[role="option"]') as HTMLElement;
    await user.click(noToolsToggle);

    expect(list.scrollTop).toBe(42);
  });

  // Review fix on card 130 (MR !1, note 12505 — the fifth re-review): the
  // fourth round's `wasAtBottom` guard was `clientHeight > 0 && scrollHeight
  // - scrollTop <= clientHeight + 1`, which reads "at the bottom" as true
  // for ANY list where `scrollHeight === clientHeight` — i.e. nothing to
  // scroll yet, which is this picker's state on every real open (both
  // sections start collapsed). That made the FIRST expansion a user ever
  // does jump the (soon-to-exist) scrollbar straight to the bottom instead
  // of showing the revealed rows from the top. Fixed by requiring the
  // container to actually be scrollable first: `scrollHeight > clientHeight
  // && ...` (ModelPicker.svelte:~670).
  //
  // What this test can and cannot prove: jsdom has no layout engine, so a
  // FRESH, real, unstubbed `commandListEl` always reports `scrollHeight ===
  // clientHeight === 0` — which reads as "not scrollable" under BOTH the
  // old guard (`clientHeight > 0` was false) and the new one (`0 > 0` is
  // false), for the same accidental reason. That means the real bug — a
  // laid-out, non-scrollable list with genuine non-zero equal metrics — is
  // structurally unobservable in jsdom regardless of which guard ships; a
  // test that rendered the component and asserted on its real, unstubbed
  // metrics here would pass before AND after the fix, proving nothing. The
  // live Chromium measurement (fresh open, click/Enter "Unverified (24)",
  // rows 1-4 visible not 21-24) recorded in board card 130's `## Comments`
  // journal is the real regression guard for the visual bug.
  //
  // What CAN be expressed here: `commandListEl`'s `scrollHeight`/
  // `clientHeight` are ordinary getters, so this pins them to a NON-zero,
  // EQUAL pair via `Object.defineProperty` — exercising the exact
  // `scrollHeight > clientHeight` boundary the fix added, rather than the
  // `0 > 0` case every other jsdom test coincidentally hits. Against the
  // OLD guard this would have failed (`clientHeight > 0` true, `140 - 0 <=
  // 141` true, so `wasAtBottom` reads true and the restore loop targets
  // `scrollHeight` (140) instead of the literal captured `scrollTop` (0)).
  it("does not treat a not-yet-scrollable list (scrollHeight === clientHeight) as 'at the bottom' on the first expansion (note 12505 — see comment above for what jsdom can/cannot prove here)", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const unverifiedNames = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(unverifiedNames.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const unverifiedToggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (${unverifiedNames.length})`,
    });

    const list = document.querySelector('[role="listbox"]') as HTMLElement;
    // Fabricate "laid out, but nothing to scroll yet": a real, non-zero
    // `scrollHeight === clientHeight` pair, not jsdom's coincidental 0 === 0.
    Object.defineProperty(list, "scrollHeight", { value: 140, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 140, configurable: true });
    list.scrollTop = 0;

    await user.click(unverifiedToggle);

    expect(screen.getByText("gateway-model-1")).toBeInTheDocument();
    // The fix: `wasAtBottom` must read false here, so the restore loop
    // targets the literal captured `scrollTop` (0), never `scrollHeight`.
    expect(list.scrollTop).toBe(0);
  });

  // Review fix on card 130 (MR !1, note 12491's re-review — the reviewer's
  // standing meta-instruction: "assert all three in one snapshot —
  // `data-selected`, `document.activeElement`, and what is actually inside
  // the list's rectangle — across all four activation paths", after three
  // prior rounds each fixed one property in isolation and broke another).
  // jsdom can genuinely express two of those three: `data-selected` (a plain
  // attribute) and `document.activeElement` (a real, spec-compliant jsdom
  // concept — no layout needed). The third, "what is actually inside the
  // list's rectangle", is NOT expressible here (see the test above) — jsdom
  // has no layout, so this test asserts the two it can, together, in one
  // block, immediately after activation, and says nothing about visibility.
  // The visibility half of the combined snapshot is the live Chromium
  // measurement in board card 130's journal, across all four paths (Enter,
  // click, filter auto-expand, popover close/reopen) — not this test.
  it("keeps data-selected and document.activeElement correct TOGETHER, in one snapshot, right after a toggle click (visibility half is a live Chromium check — see board card 130's journal)", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const noToolsNames = Array.from({ length: 9 }, (_, i) => `no-tools-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(noToolsNames.map((name) => entry(model(name), NO_TOOLS))),
    };

    render(ModelPicker);

    const noToolsToggle = (
      await screen.findByText(`${m.providerPicker_noToolSupportHeading()} (${noToolsNames.length})`)
    ).closest('[role="option"]') as HTMLElement;

    await user.click(noToolsToggle);
    await waitFor(() => expect(screen.getByText("no-tools-model-1")).toBeInTheDocument());

    // ONE snapshot, both properties, not two separate assertions in two
    // separate `waitFor`s — that separation is exactly how three prior
    // rounds each verified one property against a DOM state where the OTHER
    // had already drifted.
    expect({
      selectedValue:
        noToolsToggle.getAttribute("data-selected") !== null ? noToolsToggle.dataset.value : null,
      activeElementIsFilterInput:
        document.activeElement === screen.getByLabelText(m.providerPicker_filterAriaLabel()),
    }).toEqual({
      selectedValue: "no-tools-toggle",
      activeElementIsFilterInput: true,
    });
  });

  // Review fix on card 130 (MR !1, note 12450): `handleListKeydown` used to
  // intercept Space centrally whenever the toggle held `[data-selected]` —
  // which is exactly the state a filter query is in whenever it currently
  // has no tool-capable match, since Command auto-highlights the first
  // option on every filter change. That made an entirely ordinary filtering
  // action (typing a second word into an in-progress query) silently eat the
  // space and collapse the section instead. The fix deleted the handler
  // outright; this proves the actual regression it caused is gone — typing a
  // literal space while the toggle is highlighted must land in the filter
  // input's value, not toggle or collapse anything.
  it("types a literal space into the filter even while the toggle is highlighted, instead of toggling it", async () => {
    const user = userEvent.setup();
    // Matches the review's own measured repro: a provider name that
    // legitimately contains a space (`ModelPicker.stories.svelte`'s own
    // "Local Ollama" fixture) and a query that matches via the PROVIDER
    // name (decisions/22: "Filtering matches model id and provider name"),
    // so every row stays visible while typing "local" then " " — nothing
    // gets registered/unregistered, and the toggle keeps the highlight
    // bits-ui gave it on mount, exactly the state note 12450 measured.
    const a = provider("a", { name: "Local Ollama" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `mystery-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    await user.type(filter, "local");

    await waitFor(() =>
      expect(document.querySelector("[data-selected]")).toHaveAttribute(
        "data-value",
        "unverified-toggle",
      ),
    );
    expect(screen.getByText("mystery-model-1")).toBeInTheDocument();

    // Typing the query's next character — a literal space, exactly as
    // continuing to type "local ollama" would — must land in the filter,
    // not toggle or collapse the section.
    await user.type(filter, " ");

    expect(filter).toHaveValue("local ");
    expect(screen.getByText("mystery-model-1")).toBeInTheDocument();
    expect(
      (
        await screen.findByText(`${m.providerPicker_unverifiedHeading()} (${names.length})`)
      ).closest('[role="option"]'),
    ).not.toBeNull();
  });

  // Review fix on card 130 (MR !1, note 12384): a click on the heading WHILE
  // filtering used to be a no-op (the OR pinned the rendered state to
  // expanded regardless of the toggle) and, worse, flipped the raw toggle to
  // `true` as a side effect — so once the filter cleared, the section was
  // left stuck open. Both repro sequences from the review, reproduced here:
  // (1) filter → click to collapse → verify collapsed and rows absent;
  // (2) filter → click to collapse → clear filter → verify collapsed, not
  // latched open.
  it("makes the collapse click during filtering a real, visible toggle, and reverts to collapsed (not latched) once the filter clears", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 9 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    await user.type(filter, "gateway-model-7");

    // Auto-expanded by the filter match, as before this fix. `getByText` +
    // `.closest`, not `findByRole(..., { name })` — same jsdom/floating-ui
    // name-from-content artifact the auto-expand test above documents.
    let toggle = (await screen.findByText(`${m.providerPicker_unverifiedHeading()} (1)`)).closest(
      '[role="option"]',
    ) as HTMLElement;
    expect(screen.getByText("gateway-model-7")).toBeInTheDocument();

    // Repro 1: a click to collapse WHILE filtering must be a real, visible
    // toggle, not a no-op.
    await user.click(toggle);

    toggle = (await screen.findByText(`${m.providerPicker_unverifiedHeading()} (1)`)).closest(
      '[role="option"]',
    ) as HTMLElement;
    expect(screen.queryByText("gateway-model-7")).not.toBeInTheDocument();

    // Clicking again re-expands it — the override is a real toggle, not a
    // one-way latch either.
    await user.click(toggle);
    toggle = (await screen.findByText(`${m.providerPicker_unverifiedHeading()} (1)`)).closest(
      '[role="option"]',
    ) as HTMLElement;
    expect(screen.getByText("gateway-model-7")).toBeInTheDocument();

    // Collapse it again before clearing, to match the review's exact repro.
    await user.click(toggle);

    // Repro 2: clearing the filter after that click must NOT latch the
    // section open — it reverts to its pre-filter state (collapsed, since
    // it was never manually expanded outside filtering).
    await user.clear(filter);

    expect(
      (
        await screen.findByText(`${m.providerPicker_unverifiedHeading()} (${names.length})`)
      ).closest('[role="option"]'),
    ).not.toBeNull();
    expect(screen.queryByText("gateway-model-7")).not.toBeInTheDocument();
  });

  it("shows an unknown-capability model under Unverified with its badge label, once expanded", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("mystery"), UNKNOWN)]) };

    render(ModelPicker);

    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (1)`,
    });
    await user.click(toggle);

    const row = screen.getByText("mystery").closest('[role="option"]');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText(new RegExp(m.capabilityBadge_unverified())),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Card 130: regression guard for the scroll-trap fix (decisions/22's
  // amendment). jsdom can't prove the list actually SCROLLS — that's the
  // live Storybook check this card's gates require instead — but this proves
  // the "never hidden" half: a large Unverified bucket (the shape that
  // triggered the bug, a gateway catalog with dozens of unverified models)
  // still renders every single row — reachable after expanding the section —
  // rather than any being clipped or dropped by the fix. Decisions/43 reads
  // the never-hide rule as satisfied by "reachable after one click", not
  // "immediately on render", so the count in the collapsed heading is
  // asserted too.
  it("renders every row of a large Unverified bucket, none hidden, once expanded", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    const names = Array.from({ length: 24 }, (_, i) => `gateway-model-${i + 1}`);
    state.modelsByProvider = {
      a: loaded(names.map((name) => entry(model(name), UNKNOWN))),
    };

    render(ModelPicker);

    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (${names.length})`,
    });
    await user.click(toggle);

    for (const name of names) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // `{ hidden: true }`: expanding this section grows the popover content
    // enough to trigger a floating-ui reposition, which jsdom (no real
    // layout/ResizeObserver) leaves the floating wrapper's inline
    // `visibility: hidden` stuck on — a jsdom/floating-ui artifact, not a
    // real accessibility regression (the live Storybook check under this
    // card's gates confirms the rows are genuinely visible in a real
    // browser). Every row is still a real, present, role="option" element in
    // the DOM; this just stops testing-library's accessibility-tree
    // visibility filter from hiding them from the query. `+ 1`: the
    // disclosure toggle itself is now a real `role="option"` too (card 130
    // review fix, MR !1 note 12385), so it's part of this count alongside
    // the 24 model rows it discloses.
    expect(screen.getAllByRole("option", { hidden: true })).toHaveLength(names.length + 1);
  });

  it("shows a no-tools model under 'No tool support' with its badge label, once expanded", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("chatty"), NO_TOOLS)]) };

    render(ModelPicker);

    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_noToolSupportHeading()} (1)`,
    });
    await user.click(toggle);

    const row = screen.getByText("chatty").closest('[role="option"]');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText(new RegExp(m.capabilityBadge_noTools())),
    ).toBeInTheDocument();
  });

  // Review fix on card 130 (MR !1, note 12451): both collapsible groups had
  // lost their accessible name entirely (`aria-labelledby` resolving to
  // nothing) because neither passed `heading` — command-group.svelte's
  // `GroupHeading` is the only thing that wires `aria-labelledby` up, and a
  // doc comment claiming it happened "for free" without the prop was simply
  // false. Both now pass `heading` (with `headingHidden`, which renders it
  // `sr-only` rather than the normal visible classes — the label WITHOUT the
  // toggle's own "(N)" count, so it never collides with the toggle's visible
  // text node) — this asserts each `role="group"` has a real, non-empty
  // accessible name, not merely that an `aria-labelledby` attribute exists.
  it("gives the collapsible Unverified and No-tool-support groups a real, non-empty accessible name", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = {
      a: loaded([entry(model("mystery"), UNKNOWN), entry(model("chatty"), NO_TOOLS)]),
    };

    render(ModelPicker);

    // `getByText` + `.closest`, not `findByRole(..., { name })`, for the
    // SECOND toggle: expanding the first section triggers a floating-ui
    // reposition that jsdom's missing layout leaves stuck at inline
    // `visibility: hidden` (the same artifact the auto-expand test above
    // documents), which empties every option's accessible NAME — not just
    // the one this test is about — so a role+name query for anything after
    // that first expand is unreliable in jsdom specifically.
    const unverifiedToggle = await screen.findByRole("option", {
      name: `${m.providerPicker_unverifiedHeading()} (1)`,
    });
    await user.click(unverifiedToggle);
    const noToolsToggle = (
      await screen.findByText(`${m.providerPicker_noToolSupportHeading()} (1)`)
    ).closest('[role="option"]') as HTMLElement;
    await user.click(noToolsToggle);

    // Same reason this reads `aria-labelledby` off the DOM directly rather
    // than through `getByRole("group", { name })`: the visibility artifact
    // above would make the computed accessible name empty even though the
    // real wiring (and a real browser, per this card's live Playwright
    // check) resolves it correctly.
    function labelledText(group: Element): string | null {
      const id = group.getAttribute("aria-labelledby");
      return id ? (document.getElementById(id)?.textContent ?? null) : null;
    }
    const groups = Array.from(document.querySelectorAll('[role="group"]'));
    const unverifiedGroup = groups.find((g) => g.textContent?.includes("mystery"));
    const noToolsGroup = groups.find((g) => g.textContent?.includes("chatty"));
    expect(unverifiedGroup).toBeTruthy();
    expect(noToolsGroup).toBeTruthy();
    expect(labelledText(unverifiedGroup as Element)).toBe(m.providerPicker_unverifiedHeading());
    expect(labelledText(noToolsGroup as Element)).toBe(m.providerPicker_noToolSupportHeading());

    // The visible on-screen text stays exactly what it was — one copy of
    // each count, on the toggle row itself — the sr-only heading's own text
    // is deliberately the plain label, not a second "(1)" copy of it.
    expect(screen.getAllByText(`${m.providerPicker_unverifiedHeading()} (1)`)).toHaveLength(1);
    expect(screen.getAllByText(`${m.providerPicker_noToolSupportHeading()} (1)`)).toHaveLength(1);
  });

  // Review fix on card 130 (MR !1, note 12386): the `ollama pull` hint got
  // swept inside the same expand-gate as the rows, hiding card 14's
  // required copyable fix behind a click. decisions/43 only authorises
  // collapsing the ROWS ("only the individual rows require one click to
  // reach") — the hint has to stay visible whenever the section exists,
  // collapsed or not, matching origin/main's pre-card-130 behaviour.
  it("keeps the ollama pull hint visible for No-tool-support even while the section is collapsed", async () => {
    const a = provider("a", { name: "Ollama" });
    state.providers = [a];
    state.modelsByProvider = {
      a: loaded([entry(model("chatty-1"), NO_TOOLS), entry(model("chatty-2"), NO_TOOLS)]),
    };

    render(ModelPicker);

    await screen.findByRole("option", {
      name: `${m.providerPicker_noToolSupportHeading()} (2)`,
    });
    // Collapsed by default — the rows are gone, the hint is not.
    expect(screen.queryByText("chatty-1")).not.toBeInTheDocument();
    expect(screen.getByText("ollama pull llama3.1")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  it("marks a non-selectable row disabled and does not call selectModel when it's clicked", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("chatty"), NO_TOOLS)]) };

    render(ModelPicker);

    const toggle = await screen.findByRole("option", {
      name: `${m.providerPicker_noToolSupportHeading()} (1)`,
    });
    await user.click(toggle);

    const row = (await screen.findByText("chatty")).closest('[role="option"]') as HTMLElement;
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveAttribute("data-disabled", "");

    await user.click(row);

    expect(selectModel).not.toHaveBeenCalled();
    expect(closePicker).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("calls selectModel with the provider and model id, then closePicker, when a selectable row is clicked", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("llama3.1"), TOOL_CAPABLE)]) };

    render(ModelPicker);

    const row = (await screen.findByText("llama3.1")).closest('[role="option"]') as HTMLElement;
    expect(row).not.toHaveAttribute("aria-disabled", "true");

    await user.click(row);

    expect(selectModel).toHaveBeenCalledWith("a", "llama3.1");
    expect(closePicker).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("renders a manual model-id input for a not-supported provider and submits it through enterManualModel", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Custom Host" });
    state.providers = [a];
    state.modelsByProvider = {
      a: {
        status: "not-supported",
        message: "This provider has no model-listing API.",
        manualEntry: undefined,
      },
    };

    render(ModelPicker);

    const input = await screen.findByLabelText(
      m.providerPicker_modelIdAriaLabel({ provider: "Custom Host" }),
    );
    const submit = screen.getByRole("button", { name: m.providerPicker_checkAction() });

    await user.type(input, "gpt-4o-mini");
    await user.click(submit);

    expect(enterManualModel).toHaveBeenCalledWith("a", "gpt-4o-mini");
  });

  // -------------------------------------------------------------------------
  it("shows the provider's error message and retries via reloadModels", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = {
      a: {
        status: "error",
        message: "Could not reach Alpha.",
        error: { kind: "unreachable-or-cors", message: "Could not reach Alpha." },
      },
    };

    render(ModelPicker);

    expect(await screen.findByText("Could not reach Alpha.")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: m.retryAction() });
    await user.click(retry);

    expect(reloadModels).toHaveBeenCalledWith("a");
  });

  // -------------------------------------------------------------------------
  it("hides the filter input when there are FILTER_THRESHOLD (8) or fewer rows", async () => {
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = {
      a: loaded(Array.from({ length: 8 }, (_, i) => entry(model(`model-${i}`), TOOL_CAPABLE))),
    };

    render(ModelPicker);

    await screen.findByText("model-0");
    expect(screen.queryByLabelText(m.providerPicker_filterAriaLabel())).not.toBeInTheDocument();
  });

  it("shows the filter input past the threshold and narrows the visible rows by model id", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = {
      a: loaded(Array.from({ length: 9 }, (_, i) => entry(model(`model-${i}`), TOOL_CAPABLE))),
    };

    render(ModelPicker);

    const filter = await screen.findByLabelText(m.providerPicker_filterAriaLabel());
    expect(screen.getByText("model-0")).toBeInTheDocument();
    expect(screen.getByText("model-5")).toBeInTheDocument();

    await user.type(filter, "model-5");

    expect(screen.getByText("model-5")).toBeInTheDocument();
    expect(screen.queryByText("model-0")).not.toBeInTheDocument();
  });

  // Review fix on card 130 (MR !1, note 12452): the scroll region
  // (`Command.List`, `role="listbox"`) had no way for a keyboard-only user
  // to reach it directly once a section expanded past its own height —
  // axe-core flagged `scrollable-region-focusable` (serious). The live
  // Storybook/axe measurement is what this card's gates actually require
  // (jsdom can't lay out or scroll anything real); this just guards the
  // one DOM fact that measurement depends on, so a future edit can't drop
  // the attribute without a test noticing.
  //
  // Review follow-up (note 12479): the claim this attribute earns is
  // narrower than "arrow keys scroll it" — measured live in Chromium,
  // ArrowDown/End are consumed by Command.Root's own roving-highlight
  // `preventDefault` and never move `scrollTop`; only PageDown and Space
  // (the keys Command doesn't claim) actually scroll the region, and only
  // while focus is on the region itself (Space typed into the filter input
  // just types a space). jsdom implements no native "browser default
  // action" for ANY key — it doesn't scroll on PageDown/Space either — so a
  // `keydown` + `scrollTop` assertion here would either be vacuously true
  // for the wrong reason or fail regardless of whether the real behavior is
  // correct; it genuinely can't be expressed in jsdom. The real proof is the
  // Chromium measurement recorded on card 130's board
  // (boards/project-backlog/130-model-picker-scroll-and-density.md) and in
  // ModelPicker.svelte's own comment beside `tabindex={0}`.
  it("makes the scrollable list region itself a keyboard focus target", async () => {
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = {
      a: loaded(Array.from({ length: 9 }, (_, i) => entry(model(`model-${i}`), TOOL_CAPABLE))),
    };

    render(ModelPicker);

    await screen.findByText("model-0");
    const list = document.querySelector('[role="listbox"]');
    expect(list).toHaveAttribute("tabindex", "0");
  });
});
