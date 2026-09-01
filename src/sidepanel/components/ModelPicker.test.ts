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
import { cleanup, render, screen, within } from "@testing-library/svelte";
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
  // start collapsed behind a heading stating their count, and only render
  // their rows once that heading is clicked.
  it("starts the Unverified section collapsed (heading shows the count, row absent) and reveals its row on click", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("mystery"), UNKNOWN)]) };

    render(ModelPicker);

    const heading = await screen.findByRole("button", {
      name: `${m.providerPicker_unverifiedHeading()} (1)`,
    });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("mystery")).not.toBeInTheDocument();

    await user.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "true");
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
    const heading = await screen.findByRole("button", {
      name: `${m.providerPicker_unverifiedHeading()} (${names.length})`,
    });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("gateway-model-7")).not.toBeInTheDocument();

    const filter = screen.getByLabelText(m.providerPicker_filterAriaLabel());
    await user.type(filter, "gateway-model-7");

    // The match is visible immediately once the filter narrows the section
    // to a nonzero count — no click on the heading required. Queried by
    // text + `.closest("button")` rather than `findByRole(..., { name })`:
    // typing into the filter triggers a floating-ui reposition that jsdom's
    // missing layout leaves the popover's positioning wrapper stuck at
    // inline `visibility: hidden` — CSS `visibility` inherits, so
    // `dom-accessibility-api`'s name-from-content computation (which
    // `findByRole`'s `name` matcher relies on) treats every descendant's
    // text as hidden and returns an EMPTY accessible name for every button
    // in the popover, `{ hidden: true }` notwithstanding (that option only
    // stops the role query from excluding hidden elements outright, it
    // doesn't change how their name is computed). `getByText` matches
    // literal `textContent`, unaffected by that. Same underlying jsdom/
    // floating-ui artifact as the large-bucket regression test's `{ hidden:
    // true }` note above; confirmed via the live Storybook check this
    // card's gates require that the button and row are genuinely visible in
    // a real browser.
    const matchHeading = (
      await screen.findByText(`${m.providerPicker_unverifiedHeading()} (1)`)
    ).closest("button");
    expect(matchHeading).not.toBeNull();
    expect(matchHeading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("gateway-model-7")).toBeInTheDocument();
    expect(screen.queryByText("gateway-model-1")).not.toBeInTheDocument();

    // Clearing the filter reverts to collapsed — the auto-expand was never a
    // manual toggle, so it doesn't stick once the query is gone.
    await user.clear(filter);

    const collapsedHeading = (
      await screen.findByText(`${m.providerPicker_unverifiedHeading()} (${names.length})`)
    ).closest("button");
    expect(collapsedHeading).not.toBeNull();
    expect(collapsedHeading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("gateway-model-7")).not.toBeInTheDocument();
  });

  it("shows an unknown-capability model under Unverified with its badge label, once expanded", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("mystery"), UNKNOWN)]) };

    render(ModelPicker);

    const heading = await screen.findByRole("button", {
      name: `${m.providerPicker_unverifiedHeading()} (1)`,
    });
    await user.click(heading);

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

    const heading = await screen.findByRole("button", {
      name: `${m.providerPicker_unverifiedHeading()} (${names.length})`,
    });
    await user.click(heading);

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
    // visibility filter from hiding them from the query.
    expect(screen.getAllByRole("option", { hidden: true })).toHaveLength(names.length);
  });

  it("shows a no-tools model under 'No tool support' with its badge label, once expanded", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("chatty"), NO_TOOLS)]) };

    render(ModelPicker);

    const heading = await screen.findByRole("button", {
      name: `${m.providerPicker_noToolSupportHeading()} (1)`,
    });
    await user.click(heading);

    const row = screen.getByText("chatty").closest('[role="option"]');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText(new RegExp(m.capabilityBadge_noTools())),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  it("marks a non-selectable row disabled and does not call selectModel when it's clicked", async () => {
    const user = userEvent.setup();
    const a = provider("a", { name: "Alpha" });
    state.providers = [a];
    state.modelsByProvider = { a: loaded([entry(model("chatty"), NO_TOOLS)]) };

    render(ModelPicker);

    const heading = await screen.findByRole("button", {
      name: `${m.providerPicker_noToolSupportHeading()} (1)`,
    });
    await user.click(heading);

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
});
