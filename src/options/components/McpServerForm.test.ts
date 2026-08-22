// Component tests for McpServerForm.svelte (card 84,
// decisions/30-vitest-test-pyramid.md's component tier). Drives the form
// over `src/options/testing/fake-services.ts`'s FAKE `OptionsServices` — no
// chrome.*, no real network. See that module's header for why
// `initFakeOptionsServices` is called exactly ONCE per file (a `beforeAll`)
// rather than per test, and why NOT `vi.resetModules()`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import McpServerForm from "./McpServerForm.svelte";
import { createFakeOptionsServices, initFakeOptionsServices } from "../testing/fake-services";
import type { McpOAuthAuth, McpSignInCompletion } from "../../domain/tools";
import { ok, type Result } from "../../domain/result";
import type { StorageError } from "../../domain/storage";

// @testing-library/svelte's auto-cleanup only registers when `beforeEach`/
// `afterEach` are Vitest GLOBALS (test.globals in vitest.config.ts, which
// this project deliberately doesn't set) — without this, every test's
// rendered tree accumulates in the DOM across the whole file, producing
// "multiple elements found" and stray `pointer-events: none` failures from a
// previous test's leftover disabled state. Explicit per-file cleanup instead.
afterEach(async () => {
  cleanup();
  // bits-ui's Select body-scroll-lock (node_modules/bits-ui/dist/internal/
  // body-scroll-lock.svelte.js) restores `document.body`'s style via a REAL
  // `setTimeout(..., 24)` scheduled from the component's destroy effect, not
  // synchronously on unmount — and it restores to whatever it captured as
  // the "initial" style, which is wrong if that capture happened while an
  // earlier lock was still active. Waiting out that window (rather than only
  // force-resetting the style immediately) lets bits-ui's own bookkeeping
  // settle — `lockMap` empties and `initialBodyStyle` resets to `null` — so
  // the NEXT test's lock captures a genuinely clean body. The unconditional
  // reset after is a belt-and-braces backstop, not the primary fix.
  await new Promise((resolve) => setTimeout(resolve, 30));
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
});

// jsdom has no Pointer Events implementation (no hasPointerCapture/
// setPointerCapture/releasePointerCapture) — bits-ui's Select trigger calls
// hasPointerCapture from its pointerdown handler unconditionally. Polyfilled
// here (test-file-local, not vitest.setup.ts) rather than avoided, since
// user-event's `.click()` is the realistic interaction and the established
// workaround for bits-ui + jsdom.
if (!Element.prototype.hasPointerCapture) {
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  });
}

describe("McpServerForm", () => {
  const services = createFakeOptionsServices();
  beforeAll(() => {
    initFakeOptionsServices(services);
  });

  beforeEach(() => {
    // Reset to the module's own defaults between tests — each test that
    // needs a different mcpSignIn/permissions behaviour overrides it below.
    services.mcpSignIn.begin = async () => ({
      status: "signed-in",
      auth: fakeOAuthAuth(),
    });
    services.mcpSignIn.completeManual = async () => ({
      status: "signed-in",
      auth: fakeOAuthAuth(),
    });
    services.mcpSignIn.redirectUri = () => "https://fake-extension-id.chromiumapp.org/";
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
  });

  function fakeOAuthAuth(overrides: Partial<McpOAuthAuth> = {}): McpOAuthAuth {
    return {
      type: "oauth",
      accessToken: "fake-token",
      clientId: "fake-client-id",
      authorizationServer: {
        issuer: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
      },
      ...overrides,
    };
  }

  async function selectOption(
    user: ReturnType<typeof userEvent.setup>,
    triggerLabel: string,
    optionName: string,
  ) {
    // The trigger IS a <button>, and its <Field.Label for=...> makes its
    // accessible NAME the label text ("Transport"/"Authentication"), not its
    // current value — confirmed by direct inspection (dom-accessibility-api
    // computes name from the associated <label>, overriding the button's own
    // text content, same as a native <select>).
    await user.click(screen.getByRole("button", { name: triggerLabel }));
    // The listbox itself is bits-ui's floating-layer PORTAL content, appended
    // to `document.body` outside the render container. `getByRole`/
    // `queryAllByRole`/`getRoles` (dom-accessibility-api's role computation)
    // reliably find NOTHING inside it in this jsdom setup — confirmed with a
    // throwaway diagnostic: `role="option"` is present on every item
    // (verified via `querySelectorAll('[role="option"]')`, no `aria-hidden`
    // or `display:none` anywhere up the ancestor chain to `<html>`), yet
    // `getRoles(document.body)` never reports "option" or "listbox" at all.
    // `findByText` (a text-content query, not a role/accessibility-tree one)
    // finds the SAME portaled content without issue — as does a plain click
    // on the DOM node itself — so this uses `findByText` rather than
    // `findByRole("option", ...)` for anything inside a bits-ui portal.
    await user.click(await screen.findByText(optionName));
    // Closing the listbox releases bits-ui's body-scroll-lock on a REAL
    // `setTimeout(..., 24)` (see the `afterEach` above) — a SECOND
    // `selectOption` call in the same test, opening another Select right
    // away, can otherwise click while `document.body` still has
    // `pointer-events: none` from the first one's not-yet-released lock.
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  // ---------------------------------------------------------------------
  // Transport / auth mode switches
  // ---------------------------------------------------------------------

  it("switches the transport selection", async () => {
    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });

    expect(screen.getByRole("button", { name: "Transport" })).toHaveTextContent(
      "Auto (recommended)",
    );
    await selectOption(user, "Transport", "Streamable HTTP");
    expect(screen.getByRole("button", { name: "Transport" })).toHaveTextContent("Streamable HTTP");
  });

  it("shows the bearer token field only in bearer auth mode", async () => {
    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });

    expect(screen.queryByLabelText("Bearer token")).not.toBeInTheDocument();
    expect(screen.queryByText("OAuth sign-in")).not.toBeInTheDocument();

    await selectOption(user, "Authentication", "Bearer token");
    expect(screen.getByLabelText("Bearer token")).toBeInTheDocument();
    expect(screen.queryByText("OAuth sign-in")).not.toBeInTheDocument();

    await selectOption(user, "Authentication", "Sign in with OAuth");
    expect(screen.queryByLabelText("Bearer token")).not.toBeInTheDocument();
    expect(screen.getByText("OAuth sign-in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();

    await selectOption(user, "Authentication", "None");
    expect(screen.queryByLabelText("Bearer token")).not.toBeInTheDocument();
    expect(screen.queryByText("OAuth sign-in")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------

  it("blocks submit with no display name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ok());
    render(McpServerForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    // A genuinely EMPTY name never reaches the component's own validation at
    // all here: `#mf-name` also carries the native HTML `required` attribute,
    // and jsdom (like a real browser) refuses to fire the "submit" event for
    // an unfilled required field when a submit button is clicked — so
    // `handleSubmit` never runs. Whitespace-only satisfies `required` (any
    // non-empty value does) while still failing the component's own
    // `name.trim().length === 0` check, which is what actually exercises this
    // validation path.
    await user.type(screen.getByLabelText("Display name"), "   ");
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await user.click(screen.getByRole("button", { name: "Add server" }));

    expect(await screen.findByText("Enter a display name.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit with an invalid URL", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ok());
    render(McpServerForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "My server");
    await user.type(screen.getByLabelText("MCP endpoint URL"), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Add server" }));

    expect(await screen.findByText("Enter a valid http:// or https:// URL.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit on a reserved header name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ok());
    render(McpServerForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "My server");
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");

    await user.click(screen.getByRole("button", { name: "Add header" }));
    const nameInput = screen.getByPlaceholderText("Header name, e.g. x-api-key");
    const valueInput = screen.getByPlaceholderText("Value");
    await user.type(nameInput, "content-type");
    await user.type(valueInput, "application/json");

    await user.click(screen.getByRole("button", { name: "Add server" }));

    // Two elements now carry this substring — the HeadersEditor row's own
    // inline error (rendered reactively as soon as the row is invalid, no
    // submit needed) and the form-level `formError` banner (which restates
    // the same message once submit reaches `firstHeaderError`) — so this
    // asserts at least one match rather than the exactly-one `findByText`.
    await waitFor(() => {
      expect(
        screen.getAllByText(/is set automatically by the client and cannot be overridden/).length,
      ).toBeGreaterThan(0);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // OAuth sign-in button states over the fake sign-in service
  // ---------------------------------------------------------------------

  it("shows a pending state while sign-in is in flight, then success", async () => {
    let resolveBegin!: (value: Awaited<ReturnType<typeof services.mcpSignIn.begin>>) => void;
    services.mcpSignIn.begin = () =>
      new Promise((resolve) => {
        resolveBegin = resolve;
      });

    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await selectOption(user, "Authentication", "Sign in with OAuth");

    const signInButton = screen.getByRole("button", { name: "Sign in" });
    await user.click(signInButton);

    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();

    // No `expiresAt` override needed — `fakeOAuthAuth()`'s base object never
    // sets it, which is already "no expiry known": passing `expiresAt:
    // undefined` explicitly would require `McpOAuthAuth.expiresAt` to accept
    // literal `undefined` under `exactOptionalPropertyTypes`, which it
    // (deliberately, per src/domain/tools/servers.ts) does not.
    resolveBegin({ status: "signed-in", auth: fakeOAuthAuth() });

    expect(await screen.findByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.getByText("Connected — no expiry known.")).toBeInTheDocument();
  });

  it("shows the sign-in error and lets the user retry", async () => {
    services.mcpSignIn.begin = async () => ({ status: "error", message: "boom" });

    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await selectOption(user, "Authentication", "Sign in with OAuth");

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("hands off to the manual-client-id panel and lets a typed id enable Continue", async () => {
    services.mcpSignIn.begin = async () => ({
      status: "needs-manual-client",
      discovery: {
        issuer: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
      },
    });
    services.mcpSignIn.completeManual = vi.fn(
      async (): Promise<McpSignInCompletion> => ({ status: "signed-in", auth: fakeOAuthAuth() }),
    );

    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await selectOption(user, "Authentication", "Sign in with OAuth");

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Manual app registration")).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();

    await user.type(screen.getByLabelText("Client ID"), "my-client-id");
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);

    expect(services.mcpSignIn.completeManual).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "my-client-id" }),
    );
    expect(await screen.findByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("disconnects a signed-in OAuth credential", async () => {
    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await selectOption(user, "Authentication", "Sign in with OAuth");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("button", { name: "Reconnect" });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(screen.getByText("Not connected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Headers editor reuse (shared HeadersEditor.svelte)
  // ---------------------------------------------------------------------

  it("adds and removes a header row", async () => {
    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });

    await user.click(screen.getByRole("button", { name: "Add header" }));
    expect(screen.getByPlaceholderText("Header name, e.g. x-api-key")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Remove header/ }));
    expect(screen.queryByPlaceholderText("Header name, e.g. x-api-key")).not.toBeInTheDocument();
  });

  it("reserves Authorization only once auth is actually configured", async () => {
    const user = userEvent.setup();
    render(McpServerForm, {
      props: { mode: "add", onSubmit: vi.fn(async () => ok()), onCancel: vi.fn() },
    });

    await user.click(screen.getByRole("button", { name: "Add header" }));
    await user.type(screen.getByPlaceholderText("Header name, e.g. x-api-key"), "Authorization");
    await user.type(screen.getByPlaceholderText("Value"), "Bearer xyz");

    // No auth configured yet (authMode is "none") — not reserved.
    expect(screen.queryByText(/Authorization" is already set/)).not.toBeInTheDocument();

    await selectOption(user, "Authentication", "Bearer token");
    await user.type(screen.getByLabelText("Bearer token"), "a-real-token");

    expect(await screen.findByText(/Authorization" is already set/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Save / cancel
  // ---------------------------------------------------------------------

  it("calls onCancel, not onSubmit, when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ok());
    const onCancel = vi.fn();
    render(McpServerForm, { props: { mode: "add", onSubmit, onCancel } });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the built config and shows a saving state meanwhile", async () => {
    // Card 95: `onSubmit` returns `Result<void, StorageError>` now, so the
    // deferred promise resolves `ok()` rather than `undefined`.
    let resolveSubmit!: (result: Result<void, StorageError>) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<Result<void, StorageError>>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const user = userEvent.setup();
    render(McpServerForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "My server");
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await selectOption(user, "Authentication", "Bearer token");
    await user.type(screen.getByLabelText("Bearer token"), "secret-token");

    await user.click(screen.getByRole("button", { name: "Add server" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My server",
        url: "https://mcp.example.com",
        transport: "auto",
        auth: { type: "bearer", token: "secret-token" },
      }),
    );

    resolveSubmit(ok());
    expect(await screen.findByRole("button", { name: "Add server" })).toBeEnabled();
  });

  it("submits with the snapshotted OAuth credential when auth mode is oauth", async () => {
    const onSubmit = vi.fn(async () => ok());
    const user = userEvent.setup();
    render(McpServerForm, { props: { mode: "add", onSubmit, onCancel: vi.fn() } });

    await user.type(screen.getByLabelText("Display name"), "My server");
    await user.type(screen.getByLabelText("MCP endpoint URL"), "https://mcp.example.com");
    await selectOption(user, "Authentication", "Sign in with OAuth");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("button", { name: "Reconnect" });

    await user.click(screen.getByRole("button", { name: "Add server" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ type: "oauth", accessToken: "fake-token" }),
      }),
    );
  });
});
