// How a "Test connection" outcome RENDERS, for both registries on this page
// (card 22 for providers, card 39 for MCP servers).
//
// ONE MODULE, TWO SUBJECTS — and that is card 78's fix. This was two files,
// `testResultDisplay.ts` and `mcpTestResultDisplay.ts`, each exporting
// `testResultClass` and `testResultMessage` over a DIFFERENT outcome type.
// Four components imported them, two from each, and nothing but the import
// path said which subject a call site was formatting; the banner class map
// was also copied verbatim between them, comment and all, with a note in the
// MCP one promising to "mirror the provider version exactly". Names that say
// their subject fix the first problem, and merging fixes the second: the
// three-way ok/error/neutral treatment is now literally shared
// (`bannerClass` below) rather than mirrored, so the two registries' banners
// cannot drift.
//
// Kept separate on purpose: the WORDING. `ProviderTestOutcome` and `McpTestOutcome`
// name different failure modes for different reasons (card 39's explicit
// ask: "not an MCP endpoint" — the one users hit by pasting a web page URL —
// must say so plainly, and a successful MCP handshake with zero tools must
// not hide behind a green tick). Each kind gets its own deliberately
// different sentence below; that is copy, not duplication.
//
// Consumers: ProviderForm.svelte + ProviderRow.svelte (the provider half),
// and McpTestResult.svelte (the MCP half — the one component both
// McpServerForm.svelte and McpServerRow.svelte render, since card 81). Each
// half shares these functions specifically so testing a draft and testing a
// saved row never drift into inconsistent wording for the same underlying
// error kind.

import { m } from "../../paraglide/messages.js";
import type { McpTestOutcome } from "./mcpTestConnection";
import type { ProviderTestOutcome } from "./providerTestConnection";

/**
 * The banner's Tailwind classes for one of three readings — success reads as
 * positive, everything blocking (including "permission denied") reads as
 * destructive, a cancelled test reads as neutral. Card 71 swapped the old
 * options.css `.test-result--ok/--error/--info` classes for shadcn token
 * utilities (decisions/28-shadcn-svelte-maia-zinc.md); the three-way split is
 * unchanged, and as of card 78 there is one copy of it rather than two, and
 * as of card 90 it is exported so McpServerForm.svelte's OAuth status line
 * (a third, non-test-result use of the same three-tone banner) calls it
 * too instead of carrying its own copy of the class strings.
 */
const TEST_RESULT_BASE = "rounded-lg border px-3 py-2 text-sm";

export function bannerClass(tone: "ok" | "error" | "neutral"): string {
  switch (tone) {
    case "ok":
      return `${TEST_RESULT_BASE} border-primary/40 bg-primary/5 text-foreground`;
    case "neutral":
      return `${TEST_RESULT_BASE} text-muted-foreground`;
    case "error":
      return `${TEST_RESULT_BASE} border-destructive/40 bg-destructive/5 text-destructive`;
  }
}

// ---------------------------------------------------------------------------
// Provider registry (decisions/10)
// ---------------------------------------------------------------------------

export function providerTestResultClass(outcome: ProviderTestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return bannerClass("ok");
    case "aborted":
      return bannerClass("neutral");
    default:
      return bannerClass("error");
  }
}

export function providerTestResultMessage(outcome: ProviderTestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return m.testResultDisplay_providerSuccess({ count: outcome.modelCount });
    case "not-supported":
    case "auth":
    case "unreachable":
    case "http":
    case "invalid-response":
    case "permission-denied":
      return outcome.message;
    case "aborted":
      return m.testCancelledMessage();
    case "unexpected":
      return m.testResultDisplay_unexpectedError({ message: outcome.message });
  }
}

// ---------------------------------------------------------------------------
// MCP server registry (decisions/14)
// ---------------------------------------------------------------------------

export function mcpTestResultClass(outcome: McpTestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return bannerClass("ok");
    case "aborted":
      return bannerClass("neutral");
    default:
      return bannerClass("error");
  }
}

function serverIdentity(outcome: Extract<McpTestOutcome, { kind: "success" }>): string {
  const info = outcome.connection.serverInfo;
  if (!info) return "";
  const version = info.version ? ` v${info.version}` : "";
  return ` (${info.title ?? info.name}${version})`;
}

export function mcpTestResultMessage(outcome: McpTestOutcome): string {
  switch (outcome.kind) {
    case "success": {
      const identity = serverIdentity(outcome);
      const protocol = m.testResultDisplay_mcpProtocolLabel({
        version: outcome.connection.protocolVersion,
      });
      if (outcome.tools.length === 0) {
        return m.testResultDisplay_mcpSuccessEmpty({ identity, protocol });
      }
      return m.testResultDisplay_mcpSuccessWithTools({
        count: outcome.tools.length,
        identity,
        protocol,
      });
    }
    case "not-mcp-endpoint":
      return m.testResultDisplay_mcpNotMcpEndpoint({ message: outcome.message });
    case "auth":
      return m.testResultDisplay_mcpAuthRejected({ message: outcome.message });
    case "unreachable":
      return outcome.message;
    case "timeout":
      return outcome.message;
    case "protocol-mismatch":
      return m.testResultDisplay_mcpProtocolMismatch({ message: outcome.message });
    case "rpc-error":
      return m.testResultDisplay_mcpRpcError({ message: outcome.message });
    case "invalid-response":
      return m.testResultDisplay_mcpInvalidResponse({ message: outcome.message });
    case "aborted":
      return m.testCancelledMessage();
    case "permission-denied":
      return outcome.message;
  }
}

/** Discovered tool names+descriptions to list under the banner, or `undefined` when there's nothing to list (any non-success outcome, or a success with zero tools — already worded distinctly by {@link mcpTestResultMessage}). */
export function mcpTestResultTools(
  outcome: McpTestOutcome,
): { name: string; description?: string | undefined }[] | undefined {
  if (outcome.kind !== "success" || outcome.tools.length === 0) return undefined;
  return outcome.tools.map((t) => ({ name: t.title ?? t.name, description: t.description }));
}
