// Component tests for McpServersSection.svelte (card 84,
// decisions/30-vitest-test-pyramid.md's component tier; card 92,
// decisions/34-errors-as-values.md for the scenario below). Drives the
// section over src/options/testing/fake-services.ts's FAKE `OptionsServices`
// — no chrome.*, no real storage. See that module's header for why
// `initFakeOptionsServices` is called exactly ONCE per file (a `beforeAll`)
// rather than per test, and why NOT `vi.resetModules()`.
//
// Deliberately narrow: this file exists for ONE fact card 92 introduced —
// `refresh()`'s `listServers()` read can now fail as a checked `Result`
// instead of always resolving, and `McpServersSection.svelte` responds by
// leaving whatever was already rendered in place and logging a warning,
// rather than emptying the section and implying the user has no servers
// configured (see the component's `refresh` for the exact comment this
// mirrors). Every other behaviour of this section — add/edit/remove/reorder,
// the permission-badge lifecycle, the test-connection flow — is exercised at
// the McpServerForm/McpServerRow layer already and is not re-asserted here.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import McpServersSection from "./McpServersSection.svelte";
import {
  createFakeMcpServerRegistry,
  createFakeOptionsServices,
  initFakeOptionsServices,
  storageFailure,
} from "../testing/fake-services";
import { fail } from "../../domain/result";
import type { McpServerConfig } from "../../domain/tools";

// Same reasoning as SettingsSection.test.ts / ProviderForm.test.ts: this
// project doesn't set `test.globals` in vitest.config.ts, so
// @testing-library/svelte's auto-cleanup never registers on its own —
// without this, DOM from one test would still be present for the next.
afterEach(() => {
  cleanup();
});

function fakeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "s1",
    name: "Ticket tracker",
    url: "https://mcp.example.com",
    enabled: true,
    transport: "auto",
    ...overrides,
  };
}

describe("McpServersSection", () => {
  const services = createFakeOptionsServices();
  beforeAll(() => {
    initFakeOptionsServices(services);
  });

  beforeEach(() => {
    services.permissions.has = async () => true;
    services.permissions.request = async () => true;
  });

  it("keeps the previously-rendered rows in place when a later listServers() read fails", async () => {
    // Seed the registry with one server and let the section's initial
    // `onMount` -> `refresh()` load it successfully.
    const registry = createFakeMcpServerRegistry([fakeServer()]);
    services.mcpServers = registry;

    const user = userEvent.setup();
    render(McpServersSection);

    await waitFor(() => expect(screen.getByText("Ticket tracker")).toBeInTheDocument());
    // Sanity check on the row's own state before the failure below, so a
    // later assertion that it's UNCHANGED actually means something.
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();

    // From here on, the store can no longer be read at all — as real as a
    // `chrome.storage` quota fault or the extension context invalidating
    // mid-session. `updateServer` (the write half of the toggle below) is
    // left alone: this test is about a READ failure, not a write one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    registry.listServers = async () => fail(storageFailure());

    // Any action that calls `refresh()` exercises the failure — toggling a
    // server's enabled state is the least destructive one available from
    // this section's own UI (no native `confirm()` dialog to drive, unlike
    // Remove).
    await user.click(screen.getByRole("button", { name: "Disable" }));

    // The write itself still landed (the fake registry's `updateServer`
    // wasn't touched), but the section's list only ever gets REPLACED by a
    // successful `listServers()` — so the row stays exactly as it was
    // rendered before the click: same name, same "Disable" label (not
    // "Enable", which a successful refresh reflecting the toggle would have
    // shown), never the empty state.
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.getByText("Ticket tracker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.queryByText("No MCP servers registered yet")).not.toBeInTheDocument();

    warn.mockRestore();
  });
});
