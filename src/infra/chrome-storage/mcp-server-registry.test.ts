// Tests for the MCP server registry — CRUD, reorder, the enabled/transport
// defaults, and the sync/local credential split for both `auth` (bearer +
// oauth) and the header MAP (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpOAuthAuth } from "../../domain/tools";
import { createStorageAreaGateway } from "./area";
import { createChromeStorageMcpServerRegistry } from "./mcp-server-registry";
import { createFakeChromeStorage } from "./testing/fake-chrome-storage";

function setup() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);
  const sync = createStorageAreaGateway("sync");
  const local = createStorageAreaGateway("local");
  const registry = createChromeStorageMcpServerRegistry(sync, local);
  return { fake, registry };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const oauthAuth: McpOAuthAuth = {
  type: "oauth",
  accessToken: "at-secret",
  refreshToken: "rt-secret",
  expiresAt: Date.now() + 3600_000,
  clientId: "client-123",
  authorizationServer: {
    issuer: "https://as.example",
    authorizationEndpoint: "https://as.example/authorize",
    tokenEndpoint: "https://as.example/token",
  },
};

describe("CRUD and defaults", () => {
  it("addServer defaults enabled:true and transport:'auto' when omitted", async () => {
    const { registry } = setup();
    const added = await registry.addServer({ name: "S", url: "https://mcp.example" });
    expect(added.enabled).toBe(true);
    expect(added.transport).toBe("auto");
  });

  it("addServer respects explicit enabled/transport", async () => {
    const { registry } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      enabled: false,
      transport: "sse",
    });
    expect(added.enabled).toBe(false);
    expect(added.transport).toBe("sse");
  });

  it("listEnabledServers filters out disabled servers", async () => {
    const { registry } = setup();
    const on = await registry.addServer({ name: "On", url: "https://a.example" });
    await registry.addServer({ name: "Off", url: "https://b.example", enabled: false });

    const enabled = await registry.listEnabledServers();
    expect(enabled.map((s) => s.id)).toEqual([on.id]);
  });

  it("updateServer patches core fields; removeServer drops the record and its credentials", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: { type: "bearer", token: "tok-secret" },
    });

    const updated = await registry.updateServer(added.id, { name: "Renamed" });
    expect(updated?.name).toBe("Renamed");

    await registry.removeServer(added.id);
    await expect(registry.getServer(added.id)).resolves.toBeUndefined();
    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toBeUndefined();
  });

  it("reorderServers reorders and drops any id it omits", async () => {
    const { registry } = setup();
    const a = await registry.addServer({ name: "A", url: "https://a" });
    // B is created but deliberately left out of the reorder call below.
    await registry.addServer({ name: "B", url: "https://b" });
    const c = await registry.addServer({ name: "C", url: "https://c" });

    await registry.reorderServers([c.id, a.id]);

    const list = await registry.listServers();
    expect(list.map((s) => s.id)).toEqual([c.id, a.id]);
  });
});

describe("credential split (decisions/15) — bearer auth", () => {
  it("a bearer token lands only in local, never in the sync mcp:servers:list entry", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: { type: "bearer", token: "tok-super-secret" },
    });

    expect(JSON.stringify(fake.sync.raw())).not.toContain("tok-super-secret");
    const storedCore = (fake.sync.raw()["mcp:servers:list"] as Array<Record<string, unknown>>)[0]!;
    expect(storedCore.auth).toBeUndefined();
    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toEqual({
      type: "bearer",
      token: "tok-super-secret",
    });
  });

  it("an empty bearer token is stored as nothing (isEmpty), not as an empty-string token", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: { type: "bearer", token: "" },
    });
    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toBeUndefined();
    expect(added.auth).toBeUndefined();
  });
});

describe("credential split (decisions/15, decisions/27) — oauth auth", () => {
  it("a full oauth token set (access+refresh token, client id) lands only in local", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: oauthAuth,
    });

    const syncText = JSON.stringify(fake.sync.raw());
    expect(syncText).not.toContain("at-secret");
    expect(syncText).not.toContain("rt-secret");
    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toEqual(oauthAuth);
  });

  it("an oauth auth with no refresh token is NOT treated as empty — isEmpty is bearer-only", async () => {
    const { registry, fake } = setup();
    const { refreshToken: _refreshToken, ...withoutRefresh } = oauthAuth;
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: withoutRefresh,
    });
    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toEqual(withoutRefresh);
  });

  it("updateServer with auth: undefined explicitly clears a stored oauth token (a refresh-with-no-token can't silently delete sign-in any other way)", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: oauthAuth,
    });

    const updated = await registry.updateServer(added.id, { auth: undefined });

    expect(updated?.auth).toBeUndefined();
    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toBeUndefined();
  });

  it("updateServer used to refresh a token (the mcp-auth-token-store path) replaces auth without touching other credential parts", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: oauthAuth,
      headers: { "X-Tenant": "acme" },
    });

    const refreshed: McpOAuthAuth = { ...oauthAuth, accessToken: "at-refreshed" };
    await registry.updateServer(added.id, { auth: refreshed });

    expect(fake.local.raw()[`mcp:auth:${added.id}`]).toEqual(refreshed);
    expect(fake.local.raw()[`mcp:headers:${added.id}`]).toEqual({ "X-Tenant": "acme" });
  });
});

describe("credential split (decisions/15) — header map", () => {
  it("the whole header map lands only in local, never in sync", async () => {
    const { registry, fake } = setup();
    const added = await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      headers: { "X-Api-Key": "header-secret" },
    });

    expect(JSON.stringify(fake.sync.raw())).not.toContain("header-secret");
    expect(fake.local.raw()[`mcp:headers:${added.id}`]).toEqual({ "X-Api-Key": "header-secret" });
  });

  it("only mcp:servers:list ever appears in sync, regardless of how many credentials are configured", async () => {
    const { registry, fake } = setup();
    await registry.addServer({
      name: "S",
      url: "https://mcp.example",
      auth: { type: "bearer", token: "t" },
      headers: { "X-A": "v" },
    });
    expect(Object.keys(fake.sync.raw())).toEqual(["mcp:servers:list"]);
  });
});

describe("defensive decoding of corrupted/foreign-written storage", () => {
  it("listServers drops an entry that doesn't look like a server core", async () => {
    const { registry, fake } = setup();
    fake.sync.seed({
      "mcp:servers:list": [
        { id: "ok", name: "Good", url: "https://x", enabled: true, transport: "auto" },
        {
          id: "bad",
          name: "No transport",
          url: "https://y",
          enabled: true,
          transport: "carrier-pigeon",
        },
      ],
    });
    const list = await registry.listServers();
    expect(list.map((s) => s.id)).toEqual(["ok"]);
  });

  it("a malformed stored auth blob is dropped, leaving the server usable without it", async () => {
    const { registry, fake } = setup();
    fake.sync.seed({
      "mcp:servers:list": [
        { id: "s1", name: "S", url: "https://x", enabled: true, transport: "auto" },
      ],
    });
    fake.local.seed({ "mcp:auth:s1": { type: "oauth", accessToken: "" /* invalid: empty */ } });

    const server = await registry.getServer("s1");
    expect(server?.auth).toBeUndefined();
  });
});
