// Merges remote MCP server tools with a page's WebMCP tools into ONE list
// the model sees (decisions/14-backend-mcp-servers.md,
// decisions/19-merging-server-tools-with-page-tools.md). This is card 38's
// own module — card 37 built the transport (client.ts, registry.ts) and
// explicitly left the merge mechanics to this card; decision 19 settles the
// open questions this file implements:
//
//   §1 Namespacing: `<serverSlug>__<toolName>`, page tools stay bare, a
//      literal-name collision resolves in favour of the page tool.
//   §2 Two annotation vocabularies: the merged tool carries a NORMALISED
//      `ToolAnnotations` (readOnlyHint drives approval, same meaning in both
//      worlds) plus the original `McpToolAnnotations` for display only —
//      `destructiveHint`/`idempotentHint`/`openWorldHint` never touch
//      approval.
//   §3 Every remote result is untrusted: a server tool's normalised
//      annotations always carry `untrustedContentHint: true`, regardless of
//      what (if anything) the server said — MCP has no equivalent hint, so
//      there is nothing to read and absence is not treated as "trusted".
//      This is enough on its own to make
//      src/domain/chat/message.ts's EXISTING
//      `fenceUntrustedContent`/`toModelMessage` fence every remote result:
//      that code already fences on `toolAnnotations.untrustedContentHint`,
//      unchanged by this card.
//   §5 One executor, resolved once: every `MergedTool` carries its own
//      `call`, bound by whoever builds the list (page tools close over a
//      tabId/worker round trip, server tools close over an `McpServerConfig`
//      and `callServerTool`) — the agent loop resolves a name to an entry
//      and invokes it without ever branching on kind. See
//      src/sidepanel/services/mcpTools.ts, which is where those executors
//      are actually built (this module stays free of chrome.* APIs so it's
//      plain, synchronous, and easy to unit-reason-about).
//
// Deliberately independent of src/domain/providers (mirrors client.ts's own
// "concurrent work" note) except for `ToolAnnotations`/`SerializedTool` from
// ./tool.ts, which this module treats as a stable, narrow vocabulary rather
// than a live dependency on any one carrier's evolution.
//
// Card 73 moved this module out of src/lib/mcp into the `tools` bounded
// context and cut its two outward edges on the way (decisions/29):
//   - `originLabel` (a user-facing STRING) is presentation and now lives in
//     src/sidepanel/presentation/toolOrigin.ts; this module returns the `ToolOrigin`
//     code and the UI does the wording.
//   - `McpServerConfig` came from src/lib/mcp/registry.ts, a `chrome.storage`
//     repository — an inward edge from domain to infrastructure. Everything
//     here ever reads off a server config is `{id, name}`, so the domain now
//     names that minimum itself ({@link ToolServerIdentity}) and stays
//     generic over whatever richer config the adapter actually hands its
//     executor.

import type { SerializedTool, ToolAnnotations } from "./tool";
import type { McpServerDiscovery, McpToolAnnotations } from "./types";

// ---------------------------------------------------------------------------
// Origin — decisions/19 §6: every surface that names a tool must say where
// it runs.
// ---------------------------------------------------------------------------

export type ToolOrigin =
  | { kind: "page" }
  | { kind: "server"; serverId: string; serverName: string };

/**
 * The only thing the merge algebra needs to know about a connected MCP
 * server: its stable id (for slug assignment and `ToolOrigin`) and its
 * display name (for slugging and, downstream, for naming where a tool runs).
 * `McpServerConfig` (the stored, credential-carrying shape in the infra
 * registry) is structurally assignable to this, so callers pass their real
 * config and the domain never sees the URL, transport, auth, or headers.
 */
export interface ToolServerIdentity {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Namespacing (decisions/19 §1)
// ---------------------------------------------------------------------------

/** Separator between a server's slug and a tool's own name. Chosen in decision 19 because common provider tool-name validation (`^[a-zA-Z0-9_-]{1,64}$`) rules out `/`, `.`, `:`, and spaces. */
export const NAMESPACE_SEPARATOR = "__";

/** Provider tool-name budget decision 19 designs to (`^[a-zA-Z0-9_-]{1,64}$` is the common shape named there). */
export const MAX_TOOL_NAME_LENGTH = 64;

/** Lowercases `name` and collapses every run of characters outside `[a-z0-9]` into a single `-`, trimming leading/trailing dashes — decision 19's slug rule. Never returns an empty string (falls back to `"server"`) so a server named e.g. "🚀" or "" still gets a usable, non-empty slug. */
export function slugifyServerName(name: string): string {
  const collapsed = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return collapsed.length > 0 ? collapsed : "server";
}

/**
 * Assigns each server a unique slug, in the given order, disambiguating two
 * servers that slugify identically with a numeric suffix (decision 19 §1:
 * "disambiguated with a numeric suffix if two servers slug identically").
 * The first server to claim a base slug keeps it bare; later ones get
 * `-2`, `-3`, etc. Deterministic for a given input order — callers should
 * pass servers in a stable order (registry list order) so a slug doesn't
 * change from one call to the next without the underlying config changing.
 */
export function assignServerSlugs(
  servers: readonly { id: string; name: string }[],
): Map<string, string> {
  const seenCount = new Map<string, number>();
  const bySlug = new Map<string, string>();
  for (const server of servers) {
    const base = slugifyServerName(server.name);
    const count = (seenCount.get(base) ?? 0) + 1;
    seenCount.set(base, count);
    bySlug.set(server.id, count === 1 ? base : `${base}-${count}`);
  }
  return bySlug;
}

/**
 * Builds the model-facing name for one server tool: `${slug}__${toolName}`,
 * truncated to fit {@link MAX_TOOL_NAME_LENGTH} with the TOOL name preserved
 * in preference to the slug (decision 19 §1) — the slug shrinks first (down
 * to a 1-character floor), and only if the tool name alone (plus separator)
 * still doesn't fit is the tool name itself truncated as a last resort, so
 * the result is never longer than the limit either way.
 */
export function namespacedToolName(slug: string, toolName: string): string {
  const full = `${slug}${NAMESPACE_SEPARATOR}${toolName}`;
  if (full.length <= MAX_TOOL_NAME_LENGTH) return full;

  const maxSlugLen = Math.max(
    1,
    MAX_TOOL_NAME_LENGTH - NAMESPACE_SEPARATOR.length - toolName.length,
  );
  const shrunk = `${slug.slice(0, maxSlugLen)}${NAMESPACE_SEPARATOR}${toolName}`;
  return shrunk.length <= MAX_TOOL_NAME_LENGTH ? shrunk : shrunk.slice(0, MAX_TOOL_NAME_LENGTH);
}

/**
 * Builds one `-N` candidate for {@link disambiguateName}, reserving room for
 * the suffix UP FRONT by trimming `name` itself rather than appending the
 * suffix and then truncating the result. Appending first and truncating
 * after (the original approach) throws away exactly the suffix digits once
 * `name` is already at {@link MAX_TOOL_NAME_LENGTH} — e.g. a 64-char `name`
 * plus `"-2"` truncated back to 64 chars reproduces `name` verbatim, so the
 * "disambiguated" result collides with the very name it was meant to avoid.
 * Trimming the base first means the suffix always survives and the result
 * is always distinct from `name` and from any other suffix.
 */
function suffixedCandidate(name: string, suffix: number): string {
  const suffixText = `-${suffix}`;
  const maxBaseLen = Math.max(1, MAX_TOOL_NAME_LENGTH - suffixText.length);
  const base = name.length > maxBaseLen ? name.slice(0, maxBaseLen) : name;
  return `${base}${suffixText}`;
}

/**
 * Resolves `name` against `used` by appending `-2`, `-3`, ... until it's
 * free, mutating nothing (the caller adds the result to `used` itself).
 * Used both for the rare page-tool-squats-a-server-name case (decision 19
 * §1: "the page tool wins and the server tool is suffixed") and defensively
 * for the rarer server-tool-vs-server-tool case a shrunk/truncated name
 * could in principle produce — including two names that both already sit at
 * the {@link MAX_TOOL_NAME_LENGTH} ceiling (see {@link suffixedCandidate}).
 */
function disambiguateName(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name)) return name;
  let suffix = 2;
  let candidate = suffixedCandidate(name, suffix);
  while (used.has(candidate)) {
    suffix += 1;
    candidate = suffixedCandidate(name, suffix);
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Merged tool shape
// ---------------------------------------------------------------------------

/** Everything about a merged tool EXCEPT how to invoke it — the shape every UI surface (tools list, approval card, call log) renders from. */
export interface ToolDescriptor {
  /** The name presented to the model — bare for a page tool, namespaced for a server tool. */
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /**
   * NORMALISED annotations — exactly the two fields decisions/17 defines,
   * with `readOnlyHint` carrying the same meaning (and the same effect on
   * approval) for both a page and a server tool, and `untrustedContentHint`
   * FORCED true for every server tool regardless of what the server said
   * (decision 19 §3 — MCP has no equivalent hint, so absence is never read
   * as "trusted"). This is what approval logic and result-fencing read;
   * never trim it further and never derive approval from anything else on
   * this descriptor.
   */
  annotations: ToolAnnotations;
  /** The ORIGINAL MCP annotations (title/destructiveHint/idempotentHint/openWorldHint), for display only — `undefined` for a page tool. Decision 19 §2: these never relax or escalate approval; `destructiveHint` may only affect UI prominence. */
  mcpAnnotations?: McpToolAnnotations;
  origin: ToolOrigin;
}

/** Uniform never-throw outcome of invoking a merged tool, independent of whether it ran on the page or a remote server. */
export type MergedToolCallOutcome = { ok: true; result: unknown } | { ok: false; error: string };

export type MergedToolExecutor = (
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal },
) => Promise<MergedToolCallOutcome>;

/** One entry in the per-turn tool list (decisions/19 §5): a `ToolDescriptor` plus the one function that invokes it. `executeToolCall` in src/domain/chat/turn.ts resolves a model-requested name to one of these and calls `.call` — it never branches on `origin.kind` itself. */
export interface MergedTool extends ToolDescriptor {
  call: MergedToolExecutor;
}

// ---------------------------------------------------------------------------
// Building the merged list
// ---------------------------------------------------------------------------

/** Invokes one page tool by name — bound to a tab by src/infra/chrome-runtime's `createPageToolExecutor` and to an abort signal by its caller. Never throws. */
export type PageToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal },
) => Promise<MergedToolCallOutcome>;

// TODO: clean-code - 0.4 - KISS: ServerToolExecutor and buildServerMergedTools below are generic over a server-config shape to avoid a domain->infra inward edge from when McpServerConfig lived in a chrome.storage adapter. Since the DDD restructure, McpServerConfig has lived in ./servers.ts — the same bounded context and barrel as this file — so the inward-edge risk no longer exists, and the generic is instantiated with exactly one concrete type across the whole codebase.
/** Invokes one server tool by (config, toolName) — bound in src/sidepanel/services/mcpTools.ts, which wraps client.ts's `callServerTool` with the permission check and error-shape translation decisions/19 §4/§6 require. Never throws. */
export type ServerToolExecutor<TServer extends ToolServerIdentity = ToolServerIdentity> = (
  config: TServer,
  toolName: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal },
) => Promise<MergedToolCallOutcome>;

/**
 * Builds the SERVER half of the merged list from a batch of discoveries —
 * pure and network-free, so it can run once per discovery refresh
 * (src/sidepanel/services/mcpTools.ts) rather than once per turn. Servers
 * are slugged together as one set (via {@link assignServerSlugs}) so a slug
 * stays stable across servers regardless of which ones currently have
 * `status: "ok"` — a server flipping to `"error"` and back must not shuffle
 * another server's slug.
 *
 * A `status: "error"` entry (decisions/19 §4: dead, slow, unauthenticated,
 * or missing its host permission) contributes NOTHING here — no tools, no
 * placeholder — exactly per decision 19: "simply offers no tools that
 * turn." Surfacing *why* a server contributed nothing is a UI concern for
 * whoever reads the discovery list directly (e.g. the options page's
 * connection test, or a future status readout), not this merge step.
 */
export function buildServerMergedTools<TServer extends ToolServerIdentity>(
  entries: readonly { config: TServer; discovery: McpServerDiscovery }[],
  execute: ServerToolExecutor<TServer>,
): MergedTool[] {
  const slugs = assignServerSlugs(entries.map((e) => ({ id: e.config.id, name: e.config.name })));
  const used = new Set<string>();
  const merged: MergedTool[] = [];

  for (const { config, discovery } of entries) {
    if (discovery.status !== "ok") continue;
    const slug = slugs.get(config.id) ?? slugifyServerName(config.name);

    for (const tool of discovery.tools) {
      const name = disambiguateName(namespacedToolName(slug, tool.name), used);
      used.add(name);

      const origin: ToolOrigin = { kind: "server", serverId: config.id, serverName: config.name };
      merged.push({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint === true,
          // decisions/19 §3 — always fenced, never conditional on anything
          // the server itself reported.
          untrustedContentHint: true,
        },
        mcpAnnotations: tool.annotations,
        origin,
        call: (args, opts) => execute(config, tool.name, args, opts),
      });
    }
  }

  return merged;
}

/**
 * Combines the page's CURRENT tools with an already-built list of server
 * tools into the final per-turn list (decisions/19 §1/§5). This is the only
 * step that has to run fresh every turn — page tools can change per tab per
 * call — so it stays cheap and synchronous: no network, no storage, just
 * name resolution.
 *
 * Collision rule (decision 19 §1): the page tool ALWAYS wins its own bare
 * name; if a server tool's namespaced name happens to collide with it (only
 * possible if a page tool is literally named e.g. `myserver__sometool`,
 * since ordinary page tool names never contain the `__` separator by
 * construction), the server tool is the one suffixed, via the same
 * {@link disambiguateName} server-vs-server collisions already use.
 */
export function combineWithPageTools(
  serverTools: readonly MergedTool[],
  pageTools: readonly SerializedTool[],
  execute: PageToolExecutor,
): MergedTool[] {
  const used = new Set(pageTools.map((t) => t.name));

  const pageMerged: MergedTool[] = pageTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint === true,
      untrustedContentHint: tool.annotations?.untrustedContentHint === true,
    },
    origin: { kind: "page" },
    call: (args, opts) => execute(tool.name, args, opts),
  }));

  const resolvedServerTools: MergedTool[] = serverTools.map((tool) => {
    const name = disambiguateName(tool.name, used);
    used.add(name);
    return name === tool.name ? tool : { ...tool, name };
  });

  return [...pageMerged, ...resolvedServerTools];
}

/** Converts a {@link MergedTool} list to what `ChatProvider.chat()` actually wants — `SerializedTool`'s narrow `{name, description, inputSchema, annotations}` shape. Every provider client only ever reads these four fields off a tool def (never `origin`/`mcpAnnotations`, which are local/display-only), so this is a safe, total projection. */
export function toSerializedTools(tools: readonly MergedTool[]): SerializedTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}
