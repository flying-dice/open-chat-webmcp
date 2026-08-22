// Tests for the selection-resolution domain rules in ./registry.ts
// (decisions/10-provider-registry-and-credential-storage.md):
// resolveProvider and resolveSelection over a fake, in-memory
// ProviderRegistry — the driven port this bounded context declares but
// leaves storage-specific implementation of to src/infra.
import { describe, expect, it } from "vitest";
import {
  resolveProvider,
  resolveSelection,
  type ProviderConfig,
  type ProviderRegistry,
  type ProviderSelection,
} from "./registry";

class FakeProviderRegistry implements ProviderRegistry {
  private providers = new Map<string, ProviderConfig>();
  private defaultSelection: ProviderSelection | undefined;

  constructor(initial: ProviderConfig[] = []) {
    for (const config of initial) this.providers.set(config.id, config);
  }

  async listProviders(): Promise<ProviderConfig[]> {
    return [...this.providers.values()];
  }

  async getProvider(id: string): Promise<ProviderConfig | undefined> {
    return this.providers.get(id);
  }

  async addProvider(input: Omit<ProviderConfig, "id">): Promise<ProviderConfig> {
    const id = `provider-${this.providers.size + 1}`;
    const config: ProviderConfig = { ...input, id };
    this.providers.set(id, config);
    return config;
  }

  async updateProvider(
    id: string,
    patch: Partial<Omit<ProviderConfig, "id">>,
  ): Promise<ProviderConfig | undefined> {
    const existing = this.providers.get(id);
    if (!existing) return undefined;
    const merged: ProviderConfig = { ...existing, ...patch };
    this.providers.set(id, merged);
    return merged;
  }

  async removeProvider(id: string): Promise<void> {
    this.providers.delete(id);
    if (this.defaultSelection?.providerId === id) this.defaultSelection = undefined;
  }

  async reorderProviders(orderedIds: string[]): Promise<void> {
    const reordered = new Map<string, ProviderConfig>();
    for (const id of orderedIds) {
      const config = this.providers.get(id);
      if (config) reordered.set(id, config);
    }
    this.providers = reordered;
  }

  async getDefaultSelection(): Promise<ProviderSelection | undefined> {
    return this.defaultSelection;
  }

  async setDefaultSelection(selection: ProviderSelection): Promise<void> {
    this.defaultSelection = selection;
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
    await expect(resolveProvider(registry, "p1")).resolves.toEqual({
      status: "ok",
      config: config(),
    });
  });

  it("resolves to 'dangling' when the provider id isn't registered", async () => {
    const registry = new FakeProviderRegistry([]);
    await expect(resolveProvider(registry, "missing")).resolves.toEqual({ status: "dangling" });
  });

  it("resolves to 'dangling' for an id that was registered but has since been removed", async () => {
    const registry = new FakeProviderRegistry([config()]);
    await registry.removeProvider("p1");
    await expect(resolveProvider(registry, "p1")).resolves.toEqual({ status: "dangling" });
  });
});

describe("resolveSelection", () => {
  it("resolves to 'none' when there is no selection at all", async () => {
    const registry = new FakeProviderRegistry([]);
    await expect(resolveSelection(registry, undefined)).resolves.toEqual({ status: "none" });
  });

  it("resolves to 'ok' with the live config and the chosen model when the provider still exists", async () => {
    const registry = new FakeProviderRegistry([config()]);
    const selection: ProviderSelection = { providerId: "p1", model: "llama3" };
    await expect(resolveSelection(registry, selection)).resolves.toEqual({
      status: "ok",
      config: config(),
      model: "llama3",
    });
  });

  it("resolves to 'dangling' carrying the original providerId/model when the provider has been removed", async () => {
    const registry = new FakeProviderRegistry([]);
    const selection: ProviderSelection = { providerId: "deleted-provider", model: "llama3" };
    await expect(resolveSelection(registry, selection)).resolves.toEqual({
      status: "dangling",
      providerId: "deleted-provider",
      model: "llama3",
    });
  });

  it("distinguishes 'dangling' (chosen then removed) from 'none' (never chosen)", async () => {
    const registry = new FakeProviderRegistry([]);
    const none = await resolveSelection(registry, undefined);
    const dangling = await resolveSelection(registry, { providerId: "gone", model: "m" });
    expect(none.status).toBe("none");
    expect(dangling.status).toBe("dangling");
    expect(none.status).not.toBe(dangling.status);
  });

  it("resolves against the default selection exactly like any other ProviderSelection", async () => {
    const registry = new FakeProviderRegistry([config({ id: "p2", name: "OpenAI" })]);
    await registry.setDefaultSelection({ providerId: "p2", model: "gpt-4o" });
    const defaultSelection = await registry.getDefaultSelection();
    await expect(resolveSelection(registry, defaultSelection)).resolves.toEqual({
      status: "ok",
      config: config({ id: "p2", name: "OpenAI" }),
      model: "gpt-4o",
    });
  });
});
