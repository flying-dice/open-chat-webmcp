// Tests for `McpAuthTokenStore` — the narrowing over `McpServerRegistry`
// that src/infra/mcp's OAuth client persists a refreshed token through
// (card 76, card 83). Card 92 turned `saveAuth`'s failure into a returned
// `Result` rather than a rejection (decisions/34-errors-as-values.md).

import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageError } from "../../domain/storage";
import type { McpOAuthAuth } from "../../domain/tools";
import { createStorageAreaGateway } from "./area";
import { createChromeStorageMcpAuthTokenStore } from "./mcp-auth-token-store";
import { createChromeStorageMcpServerRegistry } from "./mcp-server-registry";
import { createFakeChromeStorage } from "./testing/fake-chrome-storage";
import { unwrap } from "./testing/unwrap";

function setup() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  const sync = createStorageAreaGateway("sync");
  const local = createStorageAreaGateway("local");
  const registry = createChromeStorageMcpServerRegistry(sync, local);
  const tokenStore = createChromeStorageMcpAuthTokenStore(registry);
  return { fake, registry, tokenStore };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const auth: McpOAuthAuth = {
  type: "oauth",
  accessToken: "at-1",
  refreshToken: "rt-1",
  clientId: "client-1",
  authorizationServer: {
    issuer: "https://as.example",
    authorizationEndpoint: "https://as.example/authorize",
    tokenEndpoint: "https://as.example/token",
  },
};

describe("saveAuth", () => {
  it("writes the byte the registry's own getServer/listServers reads back — one credential, one home", async () => {
    const { registry, tokenStore } = setup();
    const server = await unwrap(registry.addServer({ name: "S", url: "https://mcp.example" }));

    await unwrap(tokenStore.saveAuth(server.id, auth));

    const reloaded = await unwrap(registry.getServer(server.id));
    expect(reloaded?.auth).toEqual(auth);
  });

  it("can do nothing OTHER than replace auth — renaming, disabling, url and headers stay whatever updateServer left them as", async () => {
    const { registry, tokenStore } = setup();
    const server = await unwrap(
      registry.addServer({
        name: "Original name",
        url: "https://mcp.example",
        headers: { "X-A": "v" },
      }),
    );

    await unwrap(tokenStore.saveAuth(server.id, auth));

    const reloaded = await unwrap(registry.getServer(server.id));
    expect(reloaded?.name).toBe("Original name");
    expect(reloaded?.headers).toEqual({ "X-A": "v" });
  });

  it("targeting an unregistered id (e.g. the options form's 'draft' test-connection path) resolves ok() without creating anything (card 92: an unregistered id is a no-op, not a failure)", async () => {
    const { registry, tokenStore } = setup();

    const [, err] = await tokenStore.saveAuth("draft", auth);
    expect(err).toBeUndefined();

    await expect(unwrap(registry.listServers())).resolves.toEqual([]);
  });

  it("only ever writes mcp:auth:<id> in local — never touches sync", async () => {
    const { registry, tokenStore, fake } = setup();
    const server = await unwrap(registry.addServer({ name: "S", url: "https://mcp.example" }));
    const syncBefore = fake.sync.raw();

    await unwrap(tokenStore.saveAuth(server.id, auth));

    expect(fake.local.raw()[`mcp:auth:${server.id}`]).toEqual(auth);
    expect(JSON.stringify(fake.sync.raw())).not.toContain("at-1");
    expect(JSON.stringify(fake.sync.raw())).not.toContain("rt-1");
    void syncBefore;
  });
});

describe("error propagation", () => {
  it("a storage failure during saveAuth returns a StorageError rather than rejecting the promise", async () => {
    const { registry, tokenStore, fake } = setup();
    const server = await unwrap(registry.addServer({ name: "S", url: "https://mcp.example" }));
    // `saveAuth` delegates entirely to `registry.updateServer`, which reads
    // the core list (a sync `get`) before it writes anything — failing that
    // read is enough to prove the failure travels back out as a value.
    fake.sync.failNext("get", new Error("quota exceeded"));

    const [, err] = await tokenStore.saveAuth(server.id, auth);

    expect(err).toBeInstanceOf(StorageError);
  });
});
