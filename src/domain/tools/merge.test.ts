// Vitest coverage for the merge algebra (card 82, decisions/30). This is the
// richest target on the card: namespacing, slug assignment/collision,
// truncation at MAX_TOOL_NAME_LENGTH, server/page combination and the
// SerializedTool projection. No platform mocks — every executor below is a
// plain in-memory fake recording its own calls.
import { describe, expect, it } from "vitest";
import type { McpServerDiscovery, McpTool } from "./types";
import type { SerializedTool } from "./tool";
import {
  MAX_TOOL_NAME_LENGTH,
  NAMESPACE_SEPARATOR,
  assignServerSlugs,
  buildServerMergedTools,
  combineWithPageTools,
  namespacedToolName,
  slugifyServerName,
  toSerializedTools,
  type MergedTool,
  type PageToolExecutor,
  type ServerToolExecutor,
  type ToolServerIdentity,
} from "./merge";
import type { McpServerConfig } from "./servers";

// ---------------------------------------------------------------------------
// slugifyServerName
// ---------------------------------------------------------------------------

describe("slugifyServerName", () => {
  it.each([
    ["My Server", "my-server"],
    ["ALLCAPS", "allcaps"],
    ["  Weird!!Name__2  ", "weird-name-2"],
    ["already-a-slug", "already-a-slug"],
    ["a---b", "a-b"],
  ])("slugifies %j to %j", (input, expected) => {
    expect(slugifyServerName(input)).toBe(expected);
  });

  it("never returns an empty string — falls back to 'server' for input with no alphanumerics", () => {
    expect(slugifyServerName("")).toBe("server");
    expect(slugifyServerName("🚀")).toBe("server");
    expect(slugifyServerName("!!!")).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// assignServerSlugs
// ---------------------------------------------------------------------------

describe("assignServerSlugs", () => {
  it("gives each distinctly-named server its own bare slug", () => {
    const slugs = assignServerSlugs([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
    expect(slugs.get("a")).toBe("alpha");
    expect(slugs.get("b")).toBe("beta");
  });

  it("disambiguates two servers that slug identically with a numeric suffix, in input order", () => {
    const slugs = assignServerSlugs([
      { id: "first", name: "My Server" },
      { id: "second", name: "my_server" }, // slugifies to the same "my-server"
      { id: "third", name: "MY SERVER!!" },
    ]);
    expect(slugs.get("first")).toBe("my-server");
    expect(slugs.get("second")).toBe("my-server-2");
    expect(slugs.get("third")).toBe("my-server-3");
  });

  it("is deterministic for a given input order — the same list always produces the same map", () => {
    const servers = [
      { id: "a", name: "Dup" },
      { id: "b", name: "Dup" },
    ];
    expect(assignServerSlugs(servers)).toEqual(assignServerSlugs(servers));
  });

  it("does not let a later server's collision affect an earlier, unrelated slug", () => {
    const slugs = assignServerSlugs([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Alpha" },
      { id: "c", name: "Beta" },
    ]);
    expect(slugs.get("a")).toBe("alpha");
    expect(slugs.get("b")).toBe("alpha-2");
    expect(slugs.get("c")).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// namespacedToolName — separator, and the 63/64/65 truncation boundary
// ---------------------------------------------------------------------------

describe("namespacedToolName", () => {
  it("exposes the constants the naming scheme is built on", () => {
    expect(NAMESPACE_SEPARATOR).toBe("__");
    expect(MAX_TOOL_NAME_LENGTH).toBe(64);
  });

  it("joins slug and tool name with the namespace separator when it fits", () => {
    expect(namespacedToolName("myserver", "search")).toBe("myserver__search");
  });

  it("leaves a name exactly at the 64-char limit untouched (boundary: 64)", () => {
    const slug = "s".repeat(12);
    const toolName = "t".repeat(50);
    const full = `${slug}${NAMESPACE_SEPARATOR}${toolName}`;
    expect(full.length).toBe(64);
    expect(namespacedToolName(slug, toolName)).toBe(full);
  });

  it("leaves a name one under the limit untouched (boundary: 63)", () => {
    const slug = "s".repeat(11);
    const toolName = "t".repeat(50);
    const full = `${slug}${NAMESPACE_SEPARATOR}${toolName}`;
    expect(full.length).toBe(63);
    expect(namespacedToolName(slug, toolName)).toBe(full);
  });

  it("shrinks the SLUG first when the joined name is one over the limit (boundary: 65)", () => {
    const slug = "s".repeat(13);
    const toolName = "t".repeat(50);
    const full = `${slug}${NAMESPACE_SEPARATOR}${toolName}`;
    expect(full.length).toBe(65);

    const result = namespacedToolName(slug, toolName);
    expect(result.length).toBe(64);
    // Tool name preserved in full; the slug lost exactly the one char over budget.
    expect(result).toBe(`${slug.slice(0, 12)}${NAMESPACE_SEPARATOR}${toolName}`);
    expect(result.endsWith(toolName)).toBe(true);
  });

  it("shrinks the slug down to a 1-character floor before ever touching the tool name", () => {
    const slug = "s".repeat(40);
    const toolName = "t".repeat(61); // maxSlugLen = 64 - 2 - 61 = 1, exactly the floor
    const result = namespacedToolName(slug, toolName);
    expect(result.length).toBe(64);
    expect(result).toBe(`s${NAMESPACE_SEPARATOR}${toolName}`);
  });

  it("truncates the tool name itself, as a last resort, once the slug is already at its 1-char floor", () => {
    const slug = "anything-long-or-short";
    const toolName = "t".repeat(70); // too long even with a 1-char slug
    const result = namespacedToolName(slug, toolName);
    expect(result.length).toBe(64);
    // slug[0] + "__" + first 61 chars of the tool name.
    expect(result).toBe(`${slug[0]}${NAMESPACE_SEPARATOR}${toolName.slice(0, 61)}`);
  });

  it("never returns a name longer than MAX_TOOL_NAME_LENGTH, however extreme the inputs", () => {
    const result = namespacedToolName("s".repeat(200), "t".repeat(200));
    expect(result.length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for buildServerMergedTools / combineWithPageTools
// ---------------------------------------------------------------------------

function mcpTool(overrides: Partial<McpTool> & { name: string }): McpTool {
  return { ...overrides };
}

function okDiscovery(serverId: string, serverName: string, tools: McpTool[]): McpServerDiscovery {
  return {
    status: "ok",
    serverId,
    serverName,
    connection: { protocolVersion: "2025-06-18" },
    tools,
  };
}

function errorDiscovery(serverId: string, serverName: string): McpServerDiscovery {
  return {
    status: "error",
    serverId,
    serverName,
    error: { kind: "unreachable", message: "down" },
  };
}

/** A full `McpServerConfig` from just the two fields this module actually reads (card 113 de-generified `buildServerMergedTools` onto the real config type — the rest is wire detail the merge never touches). */
function serverConfig(id: string, name: string): McpServerConfig {
  return { id, name, url: `https://${id}.example.com/mcp`, enabled: true, transport: "auto" };
}

interface ServerCall {
  config: ToolServerIdentity;
  toolName: string;
  args: Record<string, unknown>;
}

function recordingServerExecutor(): {
  execute: ServerToolExecutor;
  calls: ServerCall[];
} {
  const calls: ServerCall[] = [];
  const execute: ServerToolExecutor = async (config, toolName, args) => {
    calls.push({ config, toolName, args });
    return { ok: true, result: "ok" };
  };
  return { execute, calls };
}

// ---------------------------------------------------------------------------
// buildServerMergedTools
// ---------------------------------------------------------------------------

describe("buildServerMergedTools", () => {
  it("namespaces each ok server's tools under its slug", () => {
    const { execute } = recordingServerExecutor();
    const merged = buildServerMergedTools(
      [
        {
          config: serverConfig("s1", "My Server"),
          discovery: okDiscovery("s1", "My Server", [mcpTool({ name: "search" })]),
        },
      ],
      execute,
    );
    expect(merged.map((t) => t.name)).toEqual(["my-server__search"]);
    expect(merged[0]?.origin).toEqual({ kind: "server", serverId: "s1", serverName: "My Server" });
  });

  it("contributes no tools at all for an error-status discovery — not even a placeholder", () => {
    const { execute } = recordingServerExecutor();
    const merged = buildServerMergedTools(
      [{ config: serverConfig("s1", "Dead"), discovery: errorDiscovery("s1", "Dead") }],
      execute,
    );
    expect(merged).toEqual([]);
  });

  it("slugs the whole server set together, so an error server's slug still reserves its place for an ok one with the same name", () => {
    const { execute } = recordingServerExecutor();
    const merged = buildServerMergedTools(
      [
        { config: serverConfig("err", "Foo"), discovery: errorDiscovery("err", "Foo") },
        {
          config: serverConfig("ok", "Foo"),
          discovery: okDiscovery("ok", "Foo", [mcpTool({ name: "ping" })]),
        },
      ],
      execute,
    );
    // "foo" was claimed (in order) by the error entry; the ok entry — second
    // in the list — gets the disambiguated slug even though the first
    // contributed no tools.
    expect(merged.map((t) => t.name)).toEqual(["foo-2__ping"]);
  });

  it("forces untrustedContentHint true regardless of what the server itself reported", () => {
    const { execute } = recordingServerExecutor();
    const merged = buildServerMergedTools(
      [
        {
          config: serverConfig("s1", "S"),
          discovery: okDiscovery("s1", "S", [
            mcpTool({ name: "a", annotations: { untrustedContentHint: false } }),
            mcpTool({ name: "b" }), // no annotations at all
          ]),
        },
      ],
      execute,
    );
    expect(merged.every((t) => t.annotations.untrustedContentHint === true)).toBe(true);
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("normalises readOnlyHint %j to %j", (input, expected) => {
    const { execute } = recordingServerExecutor();
    const merged = buildServerMergedTools(
      [
        {
          config: serverConfig("s1", "S"),
          discovery: okDiscovery("s1", "S", [
            mcpTool({ name: "t", annotations: { readOnlyHint: input } }),
          ]),
        },
      ],
      execute,
    );
    expect(merged[0]?.annotations.readOnlyHint).toBe(expected);
  });

  it("keeps the ORIGINAL mcpAnnotations (title/destructiveHint/etc) for display, untouched by normalisation", () => {
    const { execute } = recordingServerExecutor();
    const original = {
      title: "Search",
      readOnlyHint: true,
      destructiveHint: true,
      idempotentHint: false,
    };
    const merged = buildServerMergedTools(
      [
        {
          config: serverConfig("s1", "S"),
          discovery: okDiscovery("s1", "S", [mcpTool({ name: "t", annotations: original })]),
        },
      ],
      execute,
    );
    expect(merged[0]?.mcpAnnotations).toEqual(original);
  });

  it("disambiguates two server tools whose namespaced names collide (e.g. a server reporting the same tool name twice)", () => {
    const { execute } = recordingServerExecutor();
    const merged = buildServerMergedTools(
      [
        {
          config: serverConfig("s1", "S"),
          discovery: okDiscovery("s1", "S", [mcpTool({ name: "dup" }), mcpTool({ name: "dup" })]),
        },
      ],
      execute,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.name).toBe("s__dup");
    expect(merged[1]?.name).not.toBe(merged[0]?.name);
    expect(merged[1]?.name.startsWith("s__dup-")).toBe(true);
  });

  // Fixed on card 87 (was a known bug reported on card 82): when a
  // namespaced name is already truncated all the way to MAX_TOOL_NAME_LENGTH
  // (namespacedToolName's own last-resort branch, above), naively appending
  // `-${suffix}` and THEN truncating back to the limit threw away exactly
  // the appended suffix digits, reproducing the original colliding name.
  // `disambiguateName` (via `suffixedCandidate`) now reserves room for the
  // suffix by trimming the BASE name first, so the two tools end up with
  // distinct, still-within-budget names.
  it("disambiguates two server tools whose namespaced names both truncate to the 64-char ceiling", () => {
    const { execute } = recordingServerExecutor();
    const longName = "t".repeat(70); // forces namespacedToolName's last-resort truncation to exactly 64 chars
    const merged = buildServerMergedTools(
      [
        {
          config: serverConfig("s1", "S"),
          discovery: okDiscovery("s1", "S", [
            mcpTool({ name: longName }),
            mcpTool({ name: longName }),
          ]),
        },
      ],
      execute,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.name.length).toBe(64);
    expect(merged[1]?.name.length).toBeLessThanOrEqual(64);
    expect(merged[1]?.name).not.toBe(merged[0]?.name);
    expect(merged[1]?.name.endsWith("-2")).toBe(true);
  });

  it("binds each tool's call to (config, its ORIGINAL tool name, args, opts) — never the namespaced name", async () => {
    const { execute, calls } = recordingServerExecutor();
    const config = serverConfig("s1", "My Server");
    const merged = buildServerMergedTools(
      [{ config, discovery: okDiscovery("s1", "My Server", [mcpTool({ name: "search" })]) }],
      execute,
    );
    await merged[0]?.call({ q: "x" }, {});
    expect(calls).toEqual([{ config, toolName: "search", args: { q: "x" } }]);
  });
});

// ---------------------------------------------------------------------------
// combineWithPageTools
// ---------------------------------------------------------------------------

function serializedPageTool(overrides: Partial<SerializedTool> & { name: string }): SerializedTool {
  return { ...overrides };
}

interface PageCall {
  toolName: string;
  args: Record<string, unknown>;
}

function recordingPageExecutor(): { execute: PageToolExecutor; calls: PageCall[] } {
  const calls: PageCall[] = [];
  const execute: PageToolExecutor = async (toolName, args) => {
    calls.push({ toolName, args });
    return { ok: true, result: "ok" };
  };
  return { execute, calls };
}

function fakeServerTool(overrides: Partial<MergedTool> & { name: string }): MergedTool {
  return {
    origin: { kind: "server", serverId: "s1", serverName: "S" },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    call: async () => ({ ok: true, result: undefined }),
    ...overrides,
  };
}

describe("combineWithPageTools", () => {
  it("puts page tools before server tools, in their given order", () => {
    const page = [serializedPageTool({ name: "click" }), serializedPageTool({ name: "read" })];
    const server = [fakeServerTool({ name: "s__a" })];
    const merged = combineWithPageTools(server, page, recordingPageExecutor().execute);
    expect(merged.map((t) => t.name)).toEqual(["click", "read", "s__a"]);
  });

  it("the page tool always wins its own bare name; a colliding server tool is suffixed instead", () => {
    const page = [serializedPageTool({ name: "myserver__sometool" })];
    const server = [fakeServerTool({ name: "myserver__sometool" })];
    const merged = combineWithPageTools(server, page, recordingPageExecutor().execute);

    const pageEntry = merged.find((t) => t.origin.kind === "page");
    const serverEntry = merged.find((t) => t.origin.kind === "server");
    expect(pageEntry?.name).toBe("myserver__sometool");
    expect(serverEntry?.name).toBe("myserver__sometool-2");
  });

  it("disambiguates multiple server tools colliding with the same page name in sequence (-2, -3, ...)", () => {
    const page = [serializedPageTool({ name: "dup" })];
    const server = [fakeServerTool({ name: "dup" }), fakeServerTool({ name: "dup" })];
    const merged = combineWithPageTools(server, page, recordingPageExecutor().execute);
    const serverNames = merged.filter((t) => t.origin.kind === "server").map((t) => t.name);
    expect(serverNames).toEqual(["dup-2", "dup-3"]);
  });

  it("returns the SAME server tool object (no copy) when its name needs no disambiguation", () => {
    const server = [fakeServerTool({ name: "s__a" })];
    const merged = combineWithPageTools(server, [], recordingPageExecutor().execute);
    expect(merged[0]).toBe(server[0]);
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("normalises a page tool's readOnlyHint %j to %j", (input, expected) => {
    const page = [serializedPageTool({ name: "t", annotations: { readOnlyHint: input } })];
    const merged = combineWithPageTools([], page, recordingPageExecutor().execute);
    expect(merged[0]?.annotations.readOnlyHint).toBe(expected);
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])(
    "normalises a page tool's untrustedContentHint %j to %j (unlike a server tool, NOT forced true)",
    (input, expected) => {
      const page = [
        serializedPageTool({ name: "t", annotations: { untrustedContentHint: input } }),
      ];
      const merged = combineWithPageTools([], page, recordingPageExecutor().execute);
      expect(merged[0]?.annotations.untrustedContentHint).toBe(expected);
    },
  );

  it("binds a page tool's call to (its ORIGINAL name, args, opts)", async () => {
    const { execute, calls } = recordingPageExecutor();
    const page = [serializedPageTool({ name: "click" })];
    const merged = combineWithPageTools([], page, execute);
    await merged[0]?.call({ x: 1 }, {});
    expect(calls).toEqual([{ toolName: "click", args: { x: 1 } }]);
  });

  it("returns an empty list when there are neither page nor server tools", () => {
    expect(combineWithPageTools([], [], recordingPageExecutor().execute)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toSerializedTools
// ---------------------------------------------------------------------------

describe("toSerializedTools", () => {
  it("projects only {name, description, inputSchema, annotations} — origin, mcpAnnotations and call are dropped", () => {
    const tool = fakeServerTool({
      name: "s__a",
      description: "does a thing",
      inputSchema: { type: "object" },
      mcpAnnotations: { title: "A" },
    });
    const [serialized] = toSerializedTools([tool]);

    expect(serialized).toEqual({
      name: "s__a",
      description: "does a thing",
      inputSchema: { type: "object" },
      annotations: tool.annotations,
    });
    expect(serialized).not.toHaveProperty("origin");
    expect(serialized).not.toHaveProperty("mcpAnnotations");
    expect(serialized).not.toHaveProperty("call");
  });

  it("round-trips a mixed page+server merged list into the provider-facing shape, preserving order", () => {
    const page = [serializedPageTool({ name: "click", description: "clicks" })];
    const server = [fakeServerTool({ name: "s__a", description: "does a thing" })];
    const merged = combineWithPageTools(server, page, recordingPageExecutor().execute);

    const serialized = toSerializedTools(merged);
    expect(serialized.map((t) => t.name)).toEqual(["click", "s__a"]);
    expect(serialized.every((t) => "call" in t === false)).toBe(true);
  });

  it("returns an empty array for an empty input", () => {
    expect(toSerializedTools([])).toEqual([]);
  });
});
