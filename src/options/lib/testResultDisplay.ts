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
// Kept separate on purpose: the WORDING. `TestOutcome` and `McpTestOutcome`
// name different failure modes for different reasons (card 39's explicit
// ask: "not an MCP endpoint" — the one users hit by pasting a web page URL —
// must say so plainly, and a successful MCP handshake with zero tools must
// not hide behind a green tick). Each kind gets its own deliberately
// different sentence below; that is copy, not duplication.
//
// Consumers: ProviderForm.svelte + ProviderRow.svelte (the provider half),
// McpServerForm.svelte + McpServerRow.svelte (the MCP half). Each pair shares
// these functions specifically so testing a draft and testing a saved row
// never drift into inconsistent wording for the same underlying error kind.

import type { McpTestOutcome } from "./mcpTestConnection";
import type { TestOutcome } from "./testConnection";

/**
 * The banner's Tailwind classes for one of three readings — success reads as
 * positive, everything blocking (including "permission denied") reads as
 * destructive, a cancelled test reads as neutral. Card 71 swapped the old
 * options.css `.test-result--ok/--error/--info` classes for shadcn token
 * utilities (decisions/28-shadcn-svelte-maia-zinc.md); the three-way split is
 * unchanged, and as of card 78 there is one copy of it rather than two.
 */
// TODO: clean-code - 0.5 - DRY: McpServerForm.svelte's oauthStatusClass reimplements this exact three-tone class-string logic as a second local copy instead of calling this already-exported bannerClass("ok"|"error"|"neutral").
const TEST_RESULT_BASE = "rounded-lg border px-3 py-2 text-sm";

function bannerClass(tone: "ok" | "error" | "neutral"): string {
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

export function providerTestResultClass(outcome: TestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return bannerClass("ok");
    case "aborted":
      return bannerClass("neutral");
    default:
      return bannerClass("error");
  }
}

export function providerTestResultMessage(outcome: TestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return `Connected — found ${outcome.modelCount} model${outcome.modelCount === 1 ? "" : "s"}.`;
    case "not-supported":
    case "auth":
    case "unreachable":
    case "http":
    case "invalid-response":
    case "permission-denied":
      return outcome.message;
    case "aborted":
      return "Test was cancelled.";
    case "unexpected":
      return `Unexpected error: ${outcome.message}`;
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

/** Discovered tool names+descriptions to list under the banner, or `undefined` when there's nothing to list (any non-success outcome, or a success with zero tools — already worded distinctly by {@link mcpTestResultMessage}). */
export function mcpTestResultTools(
  outcome: McpTestOutcome,
): { name: string; description?: string }[] | undefined {
  if (outcome.kind !== "success" || outcome.tools.length === 0) return undefined;
  return outcome.tools.map((t) => ({ name: t.title ?? t.name, description: t.description }));
}
