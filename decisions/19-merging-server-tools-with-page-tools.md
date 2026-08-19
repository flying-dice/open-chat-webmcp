---
status: Accepted
date: 2026-08-20
---
# Decision 19 — How remote MCP tools merge with page tools

Implements the merge half of
[decisions/14](14-backend-mcp-servers.md). Card 37 built the transport
(`src/lib/mcp/client.ts`, `registry.ts`); this decision settles the questions
card 38 has to answer before it can wire them into the agent loop.

## Context

Decision 14 established *that* server tools merge with page tools, namespaced by
server, with the decision 05 approval policy applying unchanged to both. It
deliberately left the mechanics open. Four of them are load-bearing, and two
have shifted since decision 14 was written because
[decisions/16](16-native-webmcp-client.md) and
[decisions/17](17-spec-annotations-and-untrusted-content.md) changed what a page
tool looks like.

## Decision

### 1. Namespacing

Server tools are presented to the model as `<serverSlug>__<toolName>`. Page
tools keep their bare name.

`__` (double underscore) is the separator: provider tool-name validation is
commonly `^[a-zA-Z0-9_-]{1,64}$`, which rules out `/`, `.`, `:` and spaces.
`serverSlug` is derived from the server's display name, lowercased, with every
run of unsafe characters collapsed to `-`, and disambiguated with a numeric
suffix if two servers slug identically. Names are truncated to fit 64 characters
with the tool name preserved in preference to the slug.

Page tools stay bare because the model's primary subject is the page in front of
the user, and because renaming them would change behaviour the demo and verify
suite already pin. The merge step still guarantees global uniqueness: if a page
tool's literal name collides with a generated server name, the **page tool
wins** and the server tool is suffixed. A page is not able to shadow a server
tool by squatting a name, because the collision is resolved in favour of the
thing the user is actually looking at.

### 2. Two annotation vocabularies

Page tools carry WebMCP's `{readOnlyHint, untrustedContentHint}` (decision 17).
MCP servers carry the MCP spec's `{readOnlyHint, destructiveHint,
idempotentHint, openWorldHint, title}`. Both are real; neither is a subset of the
other. `src/lib/mcp/types.ts`'s `McpToolAnnotations` is correct as it stands and
must not be trimmed to match WebMCP's.

The merged tool carries a **normalised** annotation set for behaviour plus the
original for display:

- `readOnlyHint` means the same thing in both, but **does not drive the same
  approval rule** in both. This clause originally said the decision 17 rule
  applied unchanged to server tools; that is **superseded by
  [decisions/20](20-approval-policy-is-per-tool-source.md)**, which gives page
  tools and server tools separate policies. A server tool's `readOnlyHint` does
  not auto-run under the default policy.
- MCP's `destructiveHint` / `idempotentHint` / `openWorldHint` are **display
  only**. They never relax approval. `destructiveHint` may escalate UI warning
  prominence — it must never make a call run that would otherwise have asked.
- WebMCP's `untrustedContentHint` has no MCP equivalent. See below.

### 3. Every remote tool result is untrusted

MCP has no `untrustedContentHint`, so there is nothing to read. Rather than
treat its absence as "trusted", **all remote MCP tool results are fenced**
exactly as a page tool annotated `untrustedContentHint: true` would be
(decision 17's `fenceUntrustedContent`).

This is the safer default and the honest one: a remote server's output is
attacker-influenceable, arrives from a service the user is not looking at, and
goes straight into the model's context. A page at least sits in front of the
user. Fencing costs a delimiter and a sentence; not fencing costs a
prompt-injection path we know about and chose to leave open.

### 4. Discovery must never block the page

`discoverAllServerTools` is a network round trip per server. The agent loop must
not wait on it.

Server tool lists are **cached per server** and refreshed off the critical path.
A turn uses whatever is currently known. A server that is slow, unreachable,
unauthenticated, or missing its host permission contributes an `"error"` entry
(`McpServerDiscovery`'s existing `status: "error"`) and simply offers no tools
that turn — the page's own tools, and every other server's, are unaffected.

Host permission is requested at *add* time from a user gesture in the options UI
(card 39). The agent loop cannot request it: there is no gesture. A server whose
permission is missing at call time is reported as unavailable with that specific
reason, never as a generic failure.

### 5. One executor, resolved once

The merged list is built once per turn, each entry carrying how to invoke it —
page tools through the worker to the content relay, server tools straight out
over HTTP via `callServerTool`. The agent loop resolves a call to its executor
by name and invokes it; it does not branch on tool kind at the call site. Adding
a third source later must not mean a third branch in the loop.

### 6. The UI must say where a call runs

"Read-only" means something very different for the page you are looking at and a
remote service you are not. Every surface that names a tool — the tools list,
the approval card, the call log — states its origin: the page's origin, or the
server's display name. This is a correctness requirement, not decoration: a user
must never approve a remote action believing it is a local one.

## Consequences

- A remote `readOnlyHint` tool still auto-runs, per decision 14's explicit
  choice to leave the policy unchanged. That is a real residual risk — the hint
  is asserted by the server about itself, and the action happens somewhere the
  user cannot see. The mitigations are that the user chose to add the server,
  that the origin is always visible, and that the call is always logged.
- Fencing every remote result means the model sees delimiters around content it
  would otherwise read plainly. Some tokens, and some chance a model comments on
  the framing.
- Namespacing is visible to the model in tool names, so a server rename changes
  the names the model sees mid-conversation. Acceptable: renames are rare and
  the tool list is rebuilt per turn anyway.
- Credential and header values never appear in the merged list, the call log, or
  any error text ([decisions/15](15-custom-headers-are-credentials.md)).
