// Tests for the ProviderType -> ChatProvider factory dispatcher in
// ./client-factory.ts. `ProviderClientFactories` is typed as
// `Record<ProviderType, ...>`, so TypeScript alone already refuses to
// compile a `factories` object missing an entry for a `ProviderType` member.
// ALL_PROVIDER_TYPES + the test.each loop below is the runtime half of that
// guarantee: it structurally exercises every kind the domain knows about
// (not just spot-checking one), so a new kind added to the union without a
// matching factory entry fails this file at compile time, and a factory that
// silently mis-dispatches a known kind fails it at run time.
import { describe, expect, it, test } from "vitest";
import { createProviderClientFactory, type ProviderClientFactories } from "./client-factory";
import type { ChatProvider, ProviderType } from "./provider";
import type { ProviderConfig } from "./registry";

const ALL_PROVIDER_TYPES: ProviderType[] = ["ollama", "openai"];

function stubClient(type: ProviderType): ChatProvider {
  return {
    type,
    async listModels() {
      throw new Error("not used in these tests");
    },
    async getCapabilities() {
      throw new Error("not used in these tests");
    },
    async *chat() {
      throw new Error("not used in these tests");
    },
  };
}

function config(type: ProviderType): ProviderConfig {
  return { id: "p1", type, name: "test provider", baseUrl: "http://example.test" };
}

describe("createProviderClientFactory", () => {
  test.each(ALL_PROVIDER_TYPES)("dispatches a %s config to the %s factory, and no other", (kind) => {
    const calls: ProviderType[] = [];
    const factories: ProviderClientFactories = {
      ollama: () => {
        calls.push("ollama");
        return stubClient("ollama");
      },
      openai: () => {
        calls.push("openai");
        return stubClient("openai");
      },
    };
    const build = createProviderClientFactory(factories);
    const client = build(config(kind));
    expect(client.type).toBe(kind);
    expect(calls).toEqual([kind]);
  });

  it("passes the resolved config through to the chosen factory unchanged", () => {
    let received: ProviderConfig | undefined;
    const factories: ProviderClientFactories = {
      ollama: (cfg) => {
        received = cfg;
        return stubClient("ollama");
      },
      openai: () => stubClient("openai"),
    };
    const build = createProviderClientFactory(factories);
    const cfg = config("ollama");
    build(cfg);
    expect(received).toBe(cfg);
  });

  it("requires exactly one factory per known ProviderType — nothing missing, nothing extra", () => {
    const factories: ProviderClientFactories = {
      ollama: () => stubClient("ollama"),
      openai: () => stubClient("openai"),
    };
    expect(Object.keys(factories).sort()).toEqual([...ALL_PROVIDER_TYPES].sort());
  });
});
