// Tests for the settings store — defaults, get/set, and the two
// independent onChange subscriptions (decision 20: "a page-policy change can
// never accidentally also change the other") (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_MCP_APPROVAL_POLICY,
} from "../../domain/settings";
import { createStorageAreaGateway } from "./area";
import { createChromeStorageSettingsStore } from "./settings-store";
import { createFakeChromeStorage } from "./testing/fake-chrome-storage";

function setup() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  const sync = createStorageAreaGateway("sync");
  const store = createChromeStorageSettingsStore(sync);
  return { fake, store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("approval policy", () => {
  it("defaults to DEFAULT_APPROVAL_POLICY when unset", async () => {
    const { store } = setup();
    await expect(store.getApprovalPolicy()).resolves.toBe(DEFAULT_APPROVAL_POLICY);
  });

  it("set/get round-trip", async () => {
    const { store } = setup();
    await store.setApprovalPolicy("auto-run-all");
    await expect(store.getApprovalPolicy()).resolves.toBe("auto-run-all");
  });

  it("falls back to the default when the stored value is invalid", async () => {
    const { store, fake } = setup();
    fake.sync.seed({ "settings:approvalPolicy": "not-a-real-policy" });
    await expect(store.getApprovalPolicy()).resolves.toBe(DEFAULT_APPROVAL_POLICY);
  });

  it("onApprovalPolicyChange fires with the new value on a write", async () => {
    const { store } = setup();
    const seen: string[] = [];
    const unsubscribe = store.onApprovalPolicyChange((p) => seen.push(p));

    await store.setApprovalPolicy("auto-run-all");

    expect(seen).toEqual(["auto-run-all"]);
    unsubscribe();
  });

  it("onApprovalPolicyChange reports the DEFAULT when the stored value is cleared/invalid, never undefined", async () => {
    const { store, fake } = setup();
    const seen: unknown[] = [];
    store.onApprovalPolicyChange((p) => seen.push(p));

    await createStorageAreaGateway("sync").write({ "settings:approvalPolicy": null });

    expect(seen).toEqual([DEFAULT_APPROVAL_POLICY]);
    void fake; // keep the fake in scope for readability of the write above
  });
});

describe("mcp approval policy", () => {
  it("defaults to DEFAULT_MCP_APPROVAL_POLICY when unset", async () => {
    const { store } = setup();
    await expect(store.getMcpApprovalPolicy()).resolves.toBe(DEFAULT_MCP_APPROVAL_POLICY);
  });

  it("set/get round-trip", async () => {
    const { store } = setup();
    await store.setMcpApprovalPolicy("auto-run-all");
    await expect(store.getMcpApprovalPolicy()).resolves.toBe("auto-run-all");
  });
});

describe("the two policies never cross-fire (decision 20)", () => {
  it("writing the approval policy does not fire the mcp approval policy's subscription", async () => {
    const { store } = setup();
    const mcpSeen: unknown[] = [];
    store.onMcpApprovalPolicyChange((p) => mcpSeen.push(p));

    await store.setApprovalPolicy("auto-run-all");

    expect(mcpSeen).toEqual([]);
  });

  it("writing the mcp approval policy does not fire the approval policy's subscription", async () => {
    const { store } = setup();
    const seen: unknown[] = [];
    store.onApprovalPolicyChange((p) => seen.push(p));

    await store.setMcpApprovalPolicy("auto-run-all");

    expect(seen).toEqual([]);
  });
});
