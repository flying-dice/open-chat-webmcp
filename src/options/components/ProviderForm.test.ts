// Component tests for ProviderForm.svelte (card 84,
// decisions/30-vitest-test-pyramid.md's component tier), which also
// exercises the shared HeadersEditor.svelte it mounts. Drives the form over
// src/options/testing/fake-services.ts's FAKE `OptionsServices` — no
// chrome.*, no real network. `initFakeOptionsServices` is called exactly
// ONCE per file (a `beforeAll`), never `vi.resetModules()` — see that
// module's header comment for why (a confirmed Svelte-internal-module
// double-instantiation crash when mixed with any bits-ui component).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import ProviderForm from "./ProviderForm.svelte";
import { createFakeOptionsServices, initFakeOptionsServices } from "../testing/fake-services";
import type { ProviderConfig } from "../../domain/providers";
import { ok } from "../../domain/result";

// @testing-library/svelte's auto-cleanup only registers when `beforeEach`/
// `afterEach` are Vitest GLOBALS (test.globals, which this project
// deliberately doesn't set in vitest.config.ts) — without an explicit
// cleanup, DOM from one test accumulates into the next, producing "multiple
// elements found" failures and stray `pointer-events`/body-scroll-lock state
// left over from a still-"open" Select.
afterEach(async () => {
  cleanup();
  // bits-ui's Select restores document.body's scroll-lock style via a real
  // `setTimeout`, not synchronously on unmount — wait it out, then force-reset
  // as a backstop, so the next test's lock starts from a genuinely clean body.
  await new Promise((resolve) => setTimeout(resolve, 30));
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
});

// jsdom implements no Pointer Events (no hasPointerCapture/
// setPointerCapture/releasePointerCapture) — bits-ui's Select trigger calls
// hasPointerCapture from its pointerdown handler unconditionally.
if (!Element.prototype.hasPointerCapture) {
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  });
}

// jsdom has no ResizeObserver, which bits-ui's floating-layer positioning
// (used by Select's content) constructs unconditionally.
import "../../ui/testing/resize-observer";

// bits-ui's Select portals its listbox through a floating-layer wrapper that
// starts `visibility: hidden` until floating-ui computes a position — which
// it never can in jsdom (no real layout: every `getBoundingClientRect` is
// zero), so `getByRole("option", ...)` keeps filtering the items out as
// inaccessible no matter how long `findByRole` polls, even with
// `{hidden: true}` (confirmed by isolating a minimal `<Select>` outside this
// form and bisecting query strategies). `findByText`, which does not apply
// that visibility filter, finds the same element reliably — so this drives
// the option by its visible label text instead of by role.
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  triggerLabel: string,
  optionName: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: triggerLabel }));
  await user.click(await screen.findByText(optionName));
}

function baseConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "p1",
    type: "openai",
    name: "My OpenAI",
    baseUrl: "https://api.openai.com",
    ...overrides,
  };
}

describe("ProviderForm", () => {
  const services = createFakeOptionsServices();
  beforeAll(() => {
    initFakeOptionsServices(services);
  });

  beforeEach(() => {
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
  });

  // ---------------------------------------------------------------------
  // Field validation
  // ---------------------------------------------------------------------

  it("blocks submit and shows an error when the display name is whitespace-only", async () => {
    // The name input also carries HTML `required`, and jsdom (like a real
    // browser) refuses to even fire the `submit` event for a genuinely EMPTY
    // required field — confirmed by direct jsdom experiment while writing
    // this file, so a fully-empty name can never reach `handleSubmit`'s own
    // check via a click either way. Whitespace-only passes the native
    // `required` check (the value isn't `""`) but still fails the
    // component's own `name.trim().length === 0` guard, so it's the
    // reachable way to exercise that branch.
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.type(screen.getByLabelText("Base URL"), "http://localhost:11434");
    await user.click(screen.getByRole("button", { name: /Add provider/ }));

    expect(await screen.findByText("Enter a display name.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit and shows an error for an invalid base URL", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "My Provider");
    const urlInput = screen.getByLabelText("Base URL");
    await user.clear(urlInput);
    await user.type(urlInput, "not-a-url");
    await user.click(screen.getByRole("button", { name: /Add provider/ }));

    expect(
      await screen.findByText("Enter a valid http:// or https:// base URL."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits with a valid name and URL", async () => {
    const onSubmit = vi.fn(async (_data: Omit<ProviderConfig, "id">) => undefined);
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "Local Ollama");
    const urlInput = screen.getByLabelText("Base URL");
    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:11434");
    await user.click(screen.getByRole("button", { name: /Add provider/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0];
    expect(submitted).toMatchObject({
      type: "ollama",
      name: "Local Ollama",
      baseUrl: "http://localhost:11434",
    });
  });

  it("cancel calls onCancel without submitting", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit, onCancel } });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Masked API key show/hide
  // ---------------------------------------------------------------------

  it("masks the API key by default and toggles via Show/Hide", async () => {
    const user = userEvent.setup();
    render(ProviderForm, {
      props: {
        mode: "edit",
        initial: baseConfig({ apiKey: "sk-secret" }),
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    const keyInput = screen.getByLabelText(/API key/) as HTMLInputElement;
    expect(keyInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(keyInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(keyInput).toHaveAttribute("type", "password");
  });

  // ---------------------------------------------------------------------
  // Headers editor: add/remove + reserved-name error
  // ---------------------------------------------------------------------

  it("adds and removes header rows", async () => {
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit: vi.fn(), onCancel: vi.fn() } });

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.click(screen.getByRole("button", { name: "Add header" }));
    expect(screen.getAllByPlaceholderText("Header name, e.g. x-api-key")).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: /Remove header/ })[0]!);
    expect(screen.getAllByPlaceholderText("Header name, e.g. x-api-key")).toHaveLength(1);
  });

  it("shows an inline error for a reserved header name and blocks submit", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "Local Ollama");
    const urlInput = screen.getByLabelText("Base URL");
    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:11434");

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getByPlaceholderText("Header name, e.g. x-api-key"), "Content-Type");
    await user.type(screen.getByPlaceholderText("Value"), "application/json");

    expect(await screen.findByText(/Content-Type is set automatically/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add provider/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Header "Content-Type"/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Test connection wiring (light touch — testConnection.ts's own branches
  // are that module's job, not this component's)
  // ---------------------------------------------------------------------

  it("Test connection calls the fake provider client and renders a success result", async () => {
    services.createProviderClient = () => ({
      type: "ollama",
      listModels: async () => ok([]),
      getCapabilities: async () => ok({ status: "unknown" }),
      // eslint-disable-next-line require-yield -- test stub
      chat: async function* () {
        return;
      },
    });
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit: vi.fn(), onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "Local Ollama");
    const urlInput = screen.getByLabelText("Base URL");
    await user.clear(urlInput);
    await user.type(urlInput, "http://localhost:11434");

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/Connected — found 0 models\./)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Provider-type Select
  // ---------------------------------------------------------------------

  it("switching provider type to OpenAI-compatible reveals the API key field", async () => {
    const user = userEvent.setup();
    render(ProviderForm, { props: { mode: "add", onSubmit: vi.fn(), onCancel: vi.fn() } });

    expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument();
    await selectOption(user, "Provider type", "OpenAI-compatible");
    expect(screen.getByLabelText(/API key/)).toBeInTheDocument();
  });
});
