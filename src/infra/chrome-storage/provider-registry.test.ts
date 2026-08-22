// Tests for the provider registry — CRUD, reorder, the default-selection
// bookkeeping, and above all the sync/local credential split decisions/10
// and 15 mandate (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageError } from "../../domain/storage";
import { createStorageAreaGateway } from "./area";
import { createChromeStorageProviderRegistry } from "./provider-registry";
import { createFakeChromeStorage } from "./testing/fake-chrome-storage";

function setup() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  const sync = createStorageAreaGateway("sync");
  const local = createStorageAreaGateway("local");
  const registry = createChromeStorageProviderRegistry(sync, local);
  return { fake, registry };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CRUD", () => {
  it("addProvider assigns an id and round-trips through listProviders/getProvider", async () => {
    const { registry } = setup();
    const added = await registry.addProvider({
      type: "ollama",
      name: "Local",
      baseUrl: "http://localhost:11434",
    });
    expect(added.id).toBeTruthy();

    await expect(registry.listProviders()).resolves.toEqual([added]);
    await expect(registry.getProvider(added.id)).resolves.toEqual(added);
  });

  it("updateProvider patches core fields and returns the merged record", async () => {
    const { registry } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
    });
    const updated = await registry.updateProvider(added.id, { name: "Cloud (renamed)" });
    expect(updated?.name).toBe("Cloud (renamed)");
    expect(updated?.baseUrl).toBe("https://api.openai.com");
  });

  it("updateProvider on an unknown id returns undefined", async () => {
    const { registry } = setup();
    await expect(registry.updateProvider("nope", { name: "x" })).resolves.toBeUndefined();
  });

  it("removeProvider drops the provider and its credentials", async () => {
    const { registry, fake } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-secret",
    });
    await registry.removeProvider(added.id);

    await expect(registry.listProviders()).resolves.toEqual([]);
    expect(fake.local.raw()[`providers:apiKey:${added.id}`]).toBeUndefined();
  });

  it("reorderProviders reorders and drops any id it omits", async () => {
    const { registry } = setup();
    const a = await registry.addProvider({ type: "ollama", name: "A", baseUrl: "http://a" });
    const b = await registry.addProvider({ type: "ollama", name: "B", baseUrl: "http://b" });
    const c = await registry.addProvider({ type: "ollama", name: "C", baseUrl: "http://c" });

    await registry.reorderProviders([c.id, a.id]); // b omitted on purpose

    const list = await registry.listProviders();
    expect(list.map((p) => p.id)).toEqual([c.id, a.id]);
  });
});

describe("default selection", () => {
  it("getDefaultSelection is undefined until set, then round-trips", async () => {
    const { registry } = setup();
    await expect(registry.getDefaultSelection()).resolves.toBeUndefined();

    await registry.setDefaultSelection({ providerId: "p1", model: "m1" });
    await expect(registry.getDefaultSelection()).resolves.toEqual({
      providerId: "p1",
      model: "m1",
    });
  });

  it("removeProvider clears the default selection when it targeted the removed provider", async () => {
    const { registry } = setup();
    const added = await registry.addProvider({ type: "ollama", name: "A", baseUrl: "http://a" });
    await registry.setDefaultSelection({ providerId: added.id, model: "m1" });

    await registry.removeProvider(added.id);

    await expect(registry.getDefaultSelection()).resolves.toBeUndefined();
  });

  it("removeProvider leaves an unrelated default selection untouched", async () => {
    const { registry } = setup();
    const a = await registry.addProvider({ type: "ollama", name: "A", baseUrl: "http://a" });
    const b = await registry.addProvider({ type: "ollama", name: "B", baseUrl: "http://b" });
    await registry.setDefaultSelection({ providerId: b.id, model: "m1" });

    await registry.removeProvider(a.id);

    await expect(registry.getDefaultSelection()).resolves.toEqual({
      providerId: b.id,
      model: "m1",
    });
  });
});

describe("credential split (decisions/10, decisions/15)", () => {
  it("an apiKey lands ONLY in local, never in the sync providers:list entry", async () => {
    const { registry, fake } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-super-secret",
    });

    const syncRaw = fake.sync.raw();
    expect(JSON.stringify(syncRaw)).not.toContain("sk-super-secret");
    expect(syncRaw["providers:list"]).toBeDefined();
    const storedCore = (syncRaw["providers:list"] as Array<Record<string, unknown>>)[0];
    expect(storedCore.apiKey).toBeUndefined();

    expect(fake.local.raw()[`providers:apiKey:${added.id}`]).toBe("sk-super-secret");
  });

  it("custom header VALUES land only in local, never in sync (decisions/15)", async () => {
    const { registry, fake } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      headers: [{ key: "X-Tenant", value: "top-secret-tenant" }],
    });

    expect(JSON.stringify(fake.sync.raw())).not.toContain("top-secret-tenant");
    expect(fake.local.raw()[`providers:headers:${added.id}`]).toEqual([
      { key: "X-Tenant", value: "top-secret-tenant" },
    ]);
  });

  it("only providers:list and providers:default ever appear in sync", async () => {
    const { registry, fake } = setup();
    await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-x",
      headers: [{ key: "X-A", value: "v" }],
    });
    await registry.setDefaultSelection({ providerId: "whatever", model: "m" });

    expect(Object.keys(fake.sync.raw()).sort()).toEqual(["providers:default", "providers:list"]);
  });

  it("an empty apiKey is stored as nothing (cleared), not as an empty string", async () => {
    const { registry, fake } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      apiKey: "",
    });
    expect(fake.local.raw()[`providers:apiKey:${added.id}`]).toBeUndefined();
    expect(added.apiKey).toBeUndefined();
  });

  it("updateProvider with apiKey: undefined clears a previously-stored key", async () => {
    const { registry, fake } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-x",
    });
    expect(fake.local.raw()[`providers:apiKey:${added.id}`]).toBe("sk-x");

    const updated = await registry.updateProvider(added.id, { apiKey: undefined });

    expect(fake.local.raw()[`providers:apiKey:${added.id}`]).toBeUndefined();
    expect(updated?.apiKey).toBeUndefined();
  });

  it("updateProvider with {} (no apiKey key present) leaves a stored key untouched", async () => {
    const { registry, fake } = setup();
    const added = await registry.addProvider({
      type: "openai",
      name: "Cloud",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-x",
    });

    await registry.updateProvider(added.id, { name: "renamed" });

    expect(fake.local.raw()[`providers:apiKey:${added.id}`]).toBe("sk-x");
  });
});

describe("defensive decoding of corrupted/foreign-written storage", () => {
  it("listProviders drops an entry that doesn't look like a provider core", async () => {
    const { registry, fake } = setup();
    fake.sync.seed({
      "providers:list": [
        { id: "ok", name: "Good", baseUrl: "http://x", type: "ollama" },
        { id: "bad", name: "Missing type" }, // no `type`
        "not-even-an-object",
      ],
    });
    const list = await registry.listProviders();
    expect(list.map((p) => p.id)).toEqual(["ok"]);
  });

  it("readback of a malformed header entry is dropped, not thrown", async () => {
    const { registry, fake } = setup();
    fake.sync.seed({
      "providers:list": [{ id: "p1", name: "N", baseUrl: "http://x", type: "ollama" }],
    });
    fake.local.seed({ "providers:headers:p1": [{ key: "" /* invalid: empty */, value: "v" }] });

    const provider = await registry.getProvider("p1");
    expect(provider?.headers).toBeUndefined();
  });
});

describe("error propagation", () => {
  it("a storage failure during listProviders propagates as a StorageError, not a raw platform error", async () => {
    const { registry, fake } = setup();
    fake.sync.failNext("get", new Error("quota exceeded"));
    await expect(registry.listProviders()).rejects.toBeInstanceOf(StorageError);
  });
});
