// Shared "how does a TestOutcome render" mapping, used by both
// ProviderForm.svelte (testing a draft before saving) and ProviderRow.svelte
// (testing a saved provider) so the two never drift into inconsistent
// wording for the same underlying ProviderError kind.

import type { TestOutcome } from "./testConnection";

/**
 * Tailwind classes for the outcome banner — success reads as positive,
 * everything else (including "permission denied") reads as blocking,
 * "aborted" as neutral. Card 71 swapped the old options.css
 * `.test-result--ok/--error/--info` classes for shadcn token utilities
 * (decisions/28-shadcn-svelte-maia-zinc.md); the three-way split, and the
 * fact that both call sites share it, are unchanged.
 */
const TEST_RESULT_BASE = "rounded-lg border px-3 py-2 text-sm";

export function testResultClass(outcome: TestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return `${TEST_RESULT_BASE} border-primary/40 bg-primary/5 text-foreground`;
    case "aborted":
      return `${TEST_RESULT_BASE} text-muted-foreground`;
    default:
      return `${TEST_RESULT_BASE} border-destructive/40 bg-destructive/5 text-destructive`;
  }
}

export function testResultMessage(outcome: TestOutcome): string {
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
