// The contract that makes ./storage-fixtures.mjs safe to seed a REAL browser
// profile with (card 86, decisions/30-vitest-test-pyramid.md).
//
// The fixture is consumed twice: here, and by verify/checks/screenshots.mjs,
// which writes it straight into a live extension's `chrome.storage` before
// capturing the screenshot matrix. Nothing in that harness can tell the
// difference between a fixture the adapters accept and one they silently
// drop — `chrome.storage` takes any JSON, and every decoder in this folder is
// deliberately defensive, so a fixture that has drifted out of shape just
// produces an emptier-looking screenshot. That is what this file exists to
// prevent: every record below is read back THROUGH the production adapter
// that owns its key, so drift fails a test in `npm test` rather than
// degrading a picture nobody diffs.
//
// It is not a test of the adapters (they have their own suites next door) —
// it is a test of the FIXTURE, using the adapters as the oracle.

import { describe, expect, it, vi, afterEach } from "vitest";
import { summarizeChat } from "../../../domain/chat";
import { resolveSelection } from "../../../domain/providers";
import { DEFAULT_APPROVAL_POLICY, DEFAULT_MCP_APPROVAL_POLICY } from "../../../domain/settings";
import { createStorageAreaGateway } from "../area";
import { createChromeStorageChatStore } from "../chat-store";
import { createChromeStorageProviderRegistry } from "../provider-registry";
import { createChromeStorageSettingsStore } from "../settings-store";
import { createChromeStorageMcpServerRegistry } from "../mcp-server-registry";
import { createFakeChromeStorage } from "./fake-chrome-storage";
import {
  buildFixtureChats,
  buildStorageFixture,
  summarizeFixtureChat,
  FIXTURE_CHAT_COUNT,
  FIXTURE_CHAT_IDS,
  FIXTURE_CHAT_PROMPTS,
  FIXTURE_LOCAL_KEY_PREFIXES,
  FIXTURE_MCP_SERVER,
  FIXTURE_MODEL,
  FIXTURE_ORIGIN,
  FIXTURE_PROVIDER,
  FIXTURE_TAB,
  FIXTURE_TAB_ID,
} from "./storage-fixtures.mjs";

/** Seeds a fake `chrome.storage` with the fixture EXACTLY as the harness does — a raw `set` into each area, bypassing every adapter — and returns the adapters that have to be able to read it back. */
function seeded() {
  const fake = createFakeChromeStorage();
  vi.stubGlobal("chrome", fake.chrome);

  const { local, sync } = buildStorageFixture({ now: Date.UTC(2026, 7, 22, 12, 0, 0) });
  fake.local.seed(local);
  fake.sync.seed(sync);

  const localArea = createStorageAreaGateway("local");
  const syncArea = createStorageAreaGateway("sync");
  return {
    fake,
    raw: { local, sync },
    chats: createChromeStorageChatStore(localArea),
    providers: createChromeStorageProviderRegistry(syncArea, localArea),
    settings: createChromeStorageSettingsStore(syncArea),
    mcpServers: createChromeStorageMcpServerRegistry(syncArea, localArea),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat records round-trip through ChatStore", () => {
  it("every seeded chat reads back with its transcript and tool-call log intact", async () => {
    const { chats } = seeded();

    for (const id of FIXTURE_CHAT_IDS) {
      const chat = await chats.getChat(id);
      // `undefined` here is the failure this whole file exists for: it is
      // what `isChatSession` returns a record for when the fixture has
      // drifted, and it is invisible from a screenshot.
      expect(chat, `chat ${id} failed isChatSession validation`).toBeDefined();
      expect(chat?.origin).toBe(FIXTURE_ORIGIN);
      expect(chat?.selection).toEqual({ providerId: FIXTURE_PROVIDER.id, model: FIXTURE_MODEL });
      expect(chat?.selectionExplicit).toBe(true);
      expect(chat?.messages.length).toBeGreaterThan(0);
    }
  });

  it("the transcript's tool entries carry the four shapes the activity timeline renders", async () => {
    const { chats } = seeded();
    const chat = await chats.getChat(FIXTURE_CHAT_IDS[0]);
    const tools = chat?.messages.filter((m) => m.role === "tool") ?? [];

    expect(tools.map((t) => t.toolStatus)).toEqual(["success", "success", "denied", "error"]);
    // The untrusted server result, the denial, and the unknown-origin error
    // are the three the group's summary and badges branch on.
    expect(tools[1].toolAnnotations?.untrustedContentHint).toBe(true);
    expect(tools[1].toolOrigin).toEqual({
      kind: "server",
      serverId: FIXTURE_MCP_SERVER.id,
      serverName: FIXTURE_MCP_SERVER.name,
    });
    expect(tools[3].toolOrigin).toBeUndefined();
    // The `toolCalls`-only carrier must survive the round trip too: it is
    // what keeps the four calls reading as ONE activity group (decisions/26).
    const carrier = chat?.messages.find((m) => m.role === "assistant" && m.content === "");
    expect(carrier?.toolCalls).toHaveLength(4);
  });

  it("chat 1 is an all-success run, so its activity group is the collapsed contrast to chat 0's", async () => {
    const { chats } = seeded();
    const chat = await chats.getChat(FIXTURE_CHAT_IDS[1]);
    const statuses = (chat?.messages ?? []).filter((m) => m.role === "tool").map((m) => m.toolStatus);

    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === "success")).toBe(true);
  });

  it("chat:index matches what summarizeChat would derive, entry for entry", async () => {
    const { raw } = seeded();
    const chats = buildFixtureChats(Date.UTC(2026, 7, 22, 12, 0, 0));

    // The assertion the hand-written mirror in the fixture exists to justify:
    // it must agree with the domain's own derivation, not merely look like it.
    expect(chats.map(summarizeFixtureChat)).toEqual(chats.map(summarizeChat));
    expect(raw.local["chat:index"]).toEqual(chats.map(summarizeChat));
  });

  it("listChatSummaries returns all six, newest first, with previews the overflow menu can be clicked by", async () => {
    const { chats } = seeded();
    const summaries = await chats.listChatSummaries();

    expect(summaries).toHaveLength(FIXTURE_CHAT_COUNT);
    expect(summaries.map((s) => s.id)).toEqual(FIXTURE_CHAT_IDS);
    // The harness locates a specific chat's menu row by this text, so an
    // empty or truncated preview would break the screenshot matrix.
    expect(summaries.map((s) => s.preview)).toEqual(FIXTURE_CHAT_PROMPTS);
  });

  it("the tab pointer resolves to the newest chat rather than creating a fresh one", async () => {
    const { chats } = seeded();
    const resolved = await chats.getOrCreateChatForTab(FIXTURE_TAB_ID, FIXTURE_ORIGIN);

    expect(resolved.resolved).toBe(true);
    expect(resolved.chat.id).toBe(FIXTURE_CHAT_IDS[0]);
  });

  it("every local key the fixture writes is covered by the prefixes a consumer clears first", () => {
    const { raw } = seeded();

    // A consumer seeding a live profile clears FIXTURE_LOCAL_KEY_PREFIXES
    // and then writes `local`. A key written but not covered would survive a
    // re-seed as a stale record from the previous run.
    const uncovered = Object.keys(raw.local).filter(
      (key) => !FIXTURE_LOCAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(uncovered).toEqual([]);
  });

  it("the fake tab's URL is the origin the pointer was written for", () => {
    // `new URL(tab.url).origin` is how src/infra/chrome-runtime/tab-sync.ts
    // derives a tab's origin; if these two drift, `getOrCreateChatForTab`
    // above starts handing back an empty chat and every transcript
    // screenshot silently empties out.
    expect(new URL(FIXTURE_TAB.url).origin).toBe(FIXTURE_ORIGIN);
  });
});

describe("provider, settings and MCP records round-trip through their own adapters", () => {
  it("the provider list and default selection read back through ProviderRegistry", async () => {
    const { providers } = seeded();

    const list = await providers.listProviders();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject(FIXTURE_PROVIDER);

    const selection = await providers.getDefaultSelection();
    expect(selection).toEqual({ providerId: FIXTURE_PROVIDER.id, model: FIXTURE_MODEL });

    // The composer only unblocks on a selection that RESOLVES; a dangling one
    // would render the picker's deleted-provider path in every screenshot.
    const resolved = await resolveSelection(providers, selection);
    expect(resolved.status).toBe("ok");
  });

  it("the fixture carries no credentials, so nothing sensitive is seeded into sync", () => {
    const { raw } = seeded();
    const syncBytes = JSON.stringify(raw.sync);

    expect(syncBytes).not.toContain("apiKey");
    expect(syncBytes).not.toContain("Bearer");
    expect(Object.keys(raw.local).some((k) => k.startsWith("providers:"))).toBe(false);
  });

  it("both approval policies read back as the documented defaults", async () => {
    const { settings } = seeded();

    await expect(settings.getApprovalPolicy()).resolves.toBe(DEFAULT_APPROVAL_POLICY);
    await expect(settings.getMcpApprovalPolicy()).resolves.toBe(DEFAULT_MCP_APPROVAL_POLICY);
  });

  it("the MCP server reads back through McpServerRegistry, disabled so no screenshot run dials out", async () => {
    const { mcpServers } = seeded();
    const servers = await mcpServers.listServers();

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject(FIXTURE_MCP_SERVER);
    expect(servers[0].enabled).toBe(false);
    expect(servers[0].auth).toBeUndefined();
  });
});
