// Shared "how does an McpTestOutcome render" mapping, used by both
// McpServerForm.svelte (testing a draft before saving) and
// McpServerRow.svelte (testing a saved server) so the two never drift into
// inconsistent wording for the same underlying McpError kind — mirrors
// src/options/lib/testResultDisplay.ts's role for the provider registry.
//
// Card 39's explicit ask: failure messages must be distinct and actionable,
// and "not an MCP endpoint" in particular — the one users hit by pasting a
// web page URL — must say so plainly. Each kind below gets its own,
// deliberately different wording rather than a shared template, and the
// success case surfaces the discovered tool names rather than a bare tick
// (the point of this whole card: a server that connects but exposes
// nothing useful, or something other than expected, must be visible, not
// hidden behind a green checkmark).

import type { McpTestOutcome } from "./mcpTestConnection";

/**
 * Tailwind classes for the outcome banner — success reads as positive,
 * everything else (including "permission denied") reads as blocking,
 * "aborted" as neutral. Card 71 swapped the old options.css
 * `.test-result--ok/--error/--info` classes for shadcn token utilities
 * (decisions/28-shadcn-svelte-maia-zinc.md), mirroring
 * src/options/lib/testResultDisplay.ts exactly so the two registries' banners
 * still look identical.
 */
const TEST_RESULT_BASE = "rounded-lg border px-3 py-2 text-sm";

export function testResultClass(outcome: McpTestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return `${TEST_RESULT_BASE} border-primary/40 bg-primary/5 text-foreground`;
    case "aborted":
      return `${TEST_RESULT_BASE} text-muted-foreground`;
    default:
      return `${TEST_RESULT_BASE} border-destructive/40 bg-destructive/5 text-destructive`;
  }
}

function serverIdentity(outcome: Extract<McpTestOutcome, { kind: "success" }>): string {
  const info = outcome.connection.serverInfo;
  if (!info) return "";
  const version = info.version ? ` v${info.version}` : "";
  return ` (${info.title ?? info.name}${version})`;
}

export function testResultMessage(outcome: McpTestOutcome): string {
  switch (outcome.kind) {
    case "success": {
      const identity = serverIdentity(outcome);
      const protocol = `protocol ${outcome.connection.protocolVersion}`;
      if (outcome.tools.length === 0) {
        return `Connected${identity} — ${protocol}. The handshake succeeded but the server exposes no tools, so it won't contribute anything to the model's tool list.`;
      }
      return `Connected${identity} — ${protocol}. Found ${outcome.tools.length} tool${outcome.tools.length === 1 ? "" : "s"}:`;
    }
    case "not-mcp-endpoint":
      return `This doesn't look like an MCP server. ${outcome.message} If you pasted the URL of a normal web page, that's the likely cause — this needs the server's MCP endpoint URL, not a page meant to be viewed in a browser.`;
    case "auth":
      return `The server rejected authentication. ${outcome.message}`;
    case "unreachable":
      return outcome.message;
    case "timeout":
      return outcome.message;
    case "protocol-mismatch":
      return `The server speaks a different MCP protocol version than this extension supports. ${outcome.message}`;
    case "rpc-error":
      return `The server is an MCP endpoint but reported an error for this request. ${outcome.message}`;
    case "invalid-response":
      return `The server responded, but with something this extension couldn't understand as MCP. ${outcome.message}`;
    case "aborted":
      return "Test was cancelled.";
    case "permission-denied":
      return outcome.message;
  }
}

/** Discovered tool names+descriptions to list under the banner, or `undefined` when there's nothing to list (any non-success outcome, or a success with zero tools — already worded distinctly by testResultMessage). */
export function testResultTools(
  outcome: McpTestOutcome,
): { name: string; description?: string }[] | undefined {
  if (outcome.kind !== "success" || outcome.tools.length === 0) return undefined;
  return outcome.tools.map((t) => ({ name: t.title ?? t.name, description: t.description }));
}
