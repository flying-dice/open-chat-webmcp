// Tests for the selection-resolution domain rules in ./registry.ts
// (decisions/10-provider-registry-and-credential-storage.md):
// resolveProvider and resolveSelection over a fake, in-memory
// ProviderRegistry — the driven port this bounded context declares but
// leaves storage-specific implementation of to src/infra.
//
// Card 92 (decisions/34-errors-as-values.md): every port method, and both
// domain rules built over it, now return `Result<T, StorageError>` — a
// tuple this suite destructures with `ok`/`fail` rather than the throwing
// shape it used to assert against.
import { describe, expect, it } from "vitest";
import { fail, ok } from "../result";
import { StorageError } from "../storage";
import {
  resolveProvider,
  resolveSelection,
  type ProviderConfig,
  type ProviderRegistry,
  type ProviderSelection,
} from "./registry";

/**
 * Errors this fake should hand back instead of answering, keyed by method
 * name — how the "the store could not be read" tests below are set up
 * without adding a second, divergent fake just for the unhappy path.
 */
interface FakeProviderRegistryFailures {
  getProvider?: StorageError;
}

class FakeProviderRegistry implements ProviderRegistry {
  private providers = new Map<string, ProviderConfig>();
  private defaultSelection: ProviderSelection | undefined;

  constructor(
    initial: ProviderConfig[] = [],
    private readonly failures: FakeProviderRegistryFailures = {},
  ) {
    for (const config of initial) this.providers.set(config.id, config);
  }

  async listProviders() {
    return ok([...this.providers.values()]);
  }

  async getProvider(id: string) {
    if (this.failures.getProvider) return fail(this.failures.getProvider);
    return ok(this.providers.get(id));
  }

  async addProvider(input: Omit<ProviderConfig, "id">) {
    const id = `provider-${this.providers.size + 1}`;
    const config: ProviderConfig = { ...input, id };
    this.providers.set(id, config);
    return ok(config);
  }

  async updateProvider(id: string, patch: Partial<Omit<ProviderConfig, "id">>) {
    const existing = this.providers.get(id);
    if (!existing) return ok(undefined);
    const merged: ProviderConfig = { ...existing, ...patch };
    this.providers.set(id, merged);
    return ok(merged);
  }

  async removeProvider(id: string) {
    this.providers.delete(id);
    if (this.defaultSelection?.providerId === id) this.defaultSelection = undefined;
    return ok();
  }

  async reorderProviders(orderedIds: string[]) {
    const reordered = new Map<string, ProviderConfig>();
    for (const id of orderedIds) {
      const config = this.providers.get(id);
      if (config) reordered.set(id, config);
    }
    this.providers = reordered;
    return ok();
  }

  async getDefaultSelection() {
    return ok(this.defaultSelection);
  }

  async setDefaultSelection(selection: ProviderSelection) {
    this.defaultSelection = selection;
    return ok();
  }
}

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "p1",
    type: "ollama",
    name: "Local Ollama",
    baseUrl: "http://localhost:11434",
    ...overrides,
  };
}

describe("resolveProvider", () => {
  it("resolves to 'ok' with the config when the provider is still registered", async () => {
    const registry = new FakeProviderRegistry([config()]);
    const [resolution, err] = await resolveProvider(registry, "p1");
    expect(err).toBeUndefined();
    expect(resolution).toEqual({ status: "ok", config: config() });
  });

  it("resolves to 'dangling' when the provider id isn't registered", async () => {
    const registry = new FakeProviderRegistry([]);
    const [resolution, err] = await resolveProvider(registry, "missing");
    expect(err).toBeUndefined();
    expect(resolution).toEqual({ status: "dangling" });
  });

  it("resolves to 'dangling' for an id that was registered but has since been removed", async () => {
    const registry = new FakeProviderRegistry([config()]);
    await registry.removeProvider("p1");
    const [resolution, err] = await resolveProvider(registry, "p1");
    expect(err).toBeUndefined();
    expect(resolution).toEqual({ status: "dangling" });
  });

  it("propagates a StorageError from the port as fail(err), NOT as a 'dangling' resolution — a store that did not answer is a different fact from a provider that was deleted", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    const registry = new FakeProviderRegistry([config()], { getProvider: boom });

    const [resolution, err] = await resolveProvider(registry, "p1");

    expect(err).toBe(boom);
    expect(resolution).toBeUndefined();
  });
});

describe("resolveSelection", () => {
  it("resolves to 'none' when there is no selection at all", async () => {
    const registry = new FakeProviderRegistry([]);
    const [resolution, err] = await resolveSelection(registry, undefined);
    expect(err).toBeUndefined();
    expect(resolution).toEqual({ status: "none" });
  });

  it("resolves to 'ok' with the live config and the chosen model when the provider still exists", async () => {
    const registry = new FakeProviderRegistry([config()]);
    const selection: ProviderSelection = { providerId: "p1", model: "llama3" };
    const [resolution, err] = await resolveSelection(registry, selection);
    expect(err).toBeUndefined();
    expect(resolution).toEqual({ status: "ok", config: config(), model: "llama3" });
  });

  it("resolves to 'dangling' carrying the original providerId/model when the provider has been removed", async () => {
    const registry = new FakeProviderRegistry([]);
    const selection: ProviderSelection = { providerId: "deleted-provider", model: "llama3" };
    const [resolution, err] = await resolveSelection(registry, selection);
    expect(err).toBeUndefined();
    expect(resolution).toEqual({
      status: "dangling",
      providerId: "deleted-provider",
      model: "llama3",
    });
  });

  it("distinguishes 'dangling' (chosen then removed) from 'none' (never chosen)", async () => {
    const registry = new FakeProviderRegistry([]);
    const [none] = await resolveSelection(registry, undefined);
    const [dangling] = await resolveSelection(registry, { providerId: "gone", model: "m" });
    expect(none?.status).toBe("none");
    expect(dangling?.status).toBe("dangling");
    expect(none?.status).not.toBe(dangling?.status);
  });

  it("resolves against the default selection exactly like any other ProviderSelection", async () => {
    const registry = new FakeProviderRegistry([config({ id: "p2", name: "OpenAI" })]);
    await registry.setDefaultSelection({ providerId: "p2", model: "gpt-4o" });
    const [defaultSelection] = await registry.getDefaultSelection();
    const [resolution, err] = await resolveSelection(registry, defaultSelection);
    expect(err).toBeUndefined();
    expect(resolution).toEqual({
      status: "ok",
      config: config({ id: "p2", name: "OpenAI" }),
      model: "gpt-4o",
    });
  });

  it("propagates a StorageError from the underlying resolveProvider call as fail(err), not a 'dangling' resolution", async () => {
    const boom = new StorageError("Unavailable", "the store did not answer");
    const registry = new FakeProviderRegistry([config()], { getProvider: boom });
    const selection: ProviderSelection = { providerId: "p1", model: "llama3" };

    const [resolution, err] = await resolveSelection(registry, selection);

    expect(err).toBe(boom);
    expect(resolution).toBeUndefined();
  });
});
