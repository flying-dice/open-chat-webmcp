---
status: Accepted
date: 2026-08-20
---
# Decision 20 — Approval policy is per tool source; page and server rules never share a path

Supersedes the "approval policy applies unchanged to both kinds" clause of
[decisions/14](14-backend-mcp-servers.md), and replaces the approval sentence in
[decisions/19](19-merging-server-tools-with-page-tools.md) §2.

## Context

Decisions 14 and 19 said the decision 17 approval rule — `readOnlyHint === true`
auto-runs, everything else asks — applies unchanged to page tools and remote MCP
server tools alike. One rule, one code path, applied to a merged list.

That is wrong, and it is wrong in a way that a shared implementation actively
hides. The two are different risks with different evidence behind them:

|  | Page (WebMCP) tool | Remote MCP server tool |
|---|---|---|
| Who asserts `readOnlyHint` | the page in front of the user | a remote service the user is not looking at |
| Where the effect lands | the tab on screen | somewhere invisible, possibly authenticated as the user |
| User's ambient evidence | they can see the page change | none |
| Blast radius of a wrong hint | one page the user is watching | an account, a repo, a ticket queue |
| Precondition | content script can run | host permission granted at add time |

A single `readOnlyHint`-driven rule reads those as equivalent. They are not, and
the mistake is silent: a remote tool that lies about being read-only executes
with no prompt and no way for the user to notice.

The existing session skip-list makes the same category error concretely. It is
keyed `${pageOrigin}::${toolName}`
(`src/sidepanel/stores/approvals.svelte.ts`), which is correct for a page tool
and meaningless for a server tool — a remote tool has no relationship to the
page that happened to be open when it was approved.

## Decision

**Two independent policies, resolved by the tool's source, sharing no decision
logic.**

### Page (WebMCP) tools — unchanged

Exactly decision 17. `readOnlyHint === true` auto-runs; everything else,
including an unannotated or hallucinated tool, asks. The existing global
override (`settings:approvalPolicy`: `default` / `always-confirm` /
`auto-run-all`) and the `${pageOrigin}::${toolName}` session skip-list keep
their current meaning.

### Remote MCP server tools — new and stricter

A separate setting, `settings:mcpApprovalPolicy`, independent of the page one:

- **`always-confirm` (the default)** — every server tool call asks, regardless
  of `readOnlyHint`. A remote server's self-assertion is not sufficient grounds
  to act unseen on the user's behalf.
- `trust-read-only` — opt in to the page-style rule: `readOnlyHint` auto-runs.
  Available for users who trust their configured servers, never the default.
- `auto-run-all` — as its page counterpart.

The session skip-list for server tools is keyed **`${serverId}::${toolName}`**,
never by page origin. Approving a server's tool is a statement about that
server, and it must not be silently re-scoped to whatever tab was open.

MCP's `destructiveHint` / `idempotentHint` / `openWorldHint` remain display-only
(decision 19 §2). They may raise the prominence of a prompt; they may never
remove one.

### Host permission is a precondition, not an approval

A server whose host permission is missing has **unavailable tools**. It is not a
prompt, not a denial, and not an approval question — the agent loop cannot
request a permission because there is no user gesture. It is reported as that
specific reason and the tool is absent from the turn. This has no page-tool
counterpart and must not be folded into the approval path.

### No shared "handles both" function

Structurally: resolve the tool's source, then apply that source's policy. A
single function taking a `source` discriminator and branching internally is the
mangling this decision exists to prevent — it is where the two rules drift back
into one. Keep the page rule and the server rule in separate, separately
readable units with a thin dispatcher, so that changing one cannot quietly
change the other.

The options UI presents them as two controls with distinct copy, so a user
setting "auto-run read-only tools" for pages is never unknowingly also granting
it to remote services.

## Consequences

- Remote tools ask by default, which is more friction than decision 14 planned.
  The per-server session skip-list is what keeps this usable: approve a tool
  once per session, not once per call.
- Two settings instead of one, and two skip-list keyspaces. That is the point;
  the cost is real but the conflation it prevents is worse.
- An existing install picks up `always-confirm` for servers by default, which is
  strictly safer than what decisions 14/19 would have shipped.
- Adding a third tool source later means adding a third policy unit, not adding
  a third branch to a shared one.
