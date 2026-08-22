// Tests for the two small provider-config ports: the base-URL fallback
// store and the model-capability cache (card 83). Card 92 turned every
// method's failure into a returned `Result` rather than a rejection
// (decisions/34-errors-as-values.md).

import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageError } from "../../domain/storage";
import { createStorageAreaGateway } from "./area";
import {
  createChromeStorageModelCapabilityCache,
  createChromeStorageProviderDefaultsStore,
} from "./provider-config-store";
import { createFakeChromeStorage } from "./testing/fake-chrome-storage";
import { unwrap } from "./testing/unwrap";

function setup() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  const local = createStorageAreaGateway("local");
  return {
    fake,
    defaults: createChromeStorageProviderDefaultsStore(local),
    cache: createChromeStorageModelCapabilityCache(local),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProviderDefaultsStore", () => {
  it("getBaseUrl is undefined until set", async () => {
    const { defaults } = setup();
    await expect(unwrap(defaults.getBaseUrl("ollama"))).resolves.toBeUndefined();
  });

  it("set/get round-trips, keyed by provider type", async () => {
    const { defaults } = setup();
    await unwrap(defaults.setBaseUrl("ollama", "http://localhost:11434"));
    await unwrap(defaults.setBaseUrl("openai", "https://api.openai.com"));

    await expect(unwrap(defaults.getBaseUrl("ollama"))).resolves.toBe("http://localhost:11434");
    await expect(unwrap(defaults.getBaseUrl("openai"))).resolves.toBe("https://api.openai.com");
  });

  it("uses the byte-identical legacy key shape for ollama: 'ollama:baseUrl'", async () => {
    const { defaults, fake } = setup();
    await unwrap(defaults.setBaseUrl("ollama", "http://localhost:11434"));
    expect(fake.local.raw()["ollama:baseUrl"]).toBe("http://localhost:11434");
  });

  it("an empty stored string reads back as undefined, not as ''", async () => {
    const { defaults, fake } = setup();
    fake.local.seed({ "ollama:baseUrl": "" });
    await expect(unwrap(defaults.getBaseUrl("ollama"))).resolves.toBeUndefined();
  });

  it("lives in local, not sync (a base URL is often localhost, meaningless on another machine)", async () => {
    const { defaults, fake } = setup();
    await unwrap(defaults.setBaseUrl("ollama", "http://localhost:11434"));
    expect(fake.sync.raw()).toEqual({});
  });

  it("a storage failure during getBaseUrl returns a StorageError rather than rejecting the promise", async () => {
    const { defaults, fake } = setup();
    fake.local.failNext("get", new Error("quota exceeded"));

    const [baseUrl, err] = await defaults.getBaseUrl("ollama");

    expect(baseUrl).toBeUndefined();
    expect(err).toBeInstanceOf(StorageError);
  });
});

describe("ModelCapabilityCache", () => {
  it("get is undefined for a fingerprint never set", async () => {
    const { cache } = setup();
    await expect(unwrap(cache.get("ollama", "digest-1"))).resolves.toBeUndefined();
  });

  it("set/get round-trips, keyed by type + fingerprint", async () => {
    const { cache } = setup();
    await unwrap(cache.set("ollama", "digest-1", { status: "tool-capable", detail: ["tools"] }));
    await expect(unwrap(cache.get("ollama", "digest-1"))).resolves.toEqual({
      status: "tool-capable",
      detail: ["tools"],
    });
  });

  it("uses the byte-identical legacy key shape for ollama: 'ollama:cap:<digest>'", async () => {
    const { cache, fake } = setup();
    await unwrap(cache.set("ollama", "digest-1", { status: "no-tools" }));
    expect(fake.local.raw()["ollama:cap:digest-1"]).toEqual({ status: "no-tools" });
  });

  it("a malformed cached entry (bad status) is treated as a miss, not thrown", async () => {
    const { cache, fake } = setup();
    fake.local.seed({ "ollama:cap:digest-1": { status: "definitely-not-a-real-status" } });
    await expect(unwrap(cache.get("ollama", "digest-1"))).resolves.toBeUndefined();
  });

  it("a malformed cached entry (detail not an array) is treated as a miss", async () => {
    const { cache, fake } = setup();
    fake.local.seed({ "ollama:cap:digest-1": { status: "tool-capable", detail: "not-an-array" } });
    await expect(unwrap(cache.get("ollama", "digest-1"))).resolves.toBeUndefined();
  });

  it("lives in local, not sync (derived, machine-specific data)", async () => {
    const { cache, fake } = setup();
    await unwrap(cache.set("ollama", "digest-1", { status: "tool-capable" }));
    expect(fake.sync.raw()).toEqual({});
  });

  it("a storage failure during get returns a StorageError rather than rejecting the promise", async () => {
    const { cache, fake } = setup();
    fake.local.failNext("get", new Error("quota exceeded"));

    const [entry, err] = await cache.get("ollama", "digest-1");

    expect(entry).toBeUndefined();
    expect(err).toBeInstanceOf(StorageError);
  });
});
