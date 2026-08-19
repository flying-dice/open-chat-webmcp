// Shared "how does a TestOutcome render" mapping, used by both
// ProviderForm.svelte (testing a draft before saving) and ProviderRow.svelte
// (testing a saved provider) so the two never drift into inconsistent
// wording for the same underlying ProviderError kind.

import type { TestOutcome } from "./testConnection";

/** CSS class for the outcome banner — success reads as positive, everything else (including "permission denied") reads as blocking, "aborted" as neutral. */
export function testResultClass(outcome: TestOutcome): string {
  switch (outcome.kind) {
    case "success":
      return "test-result--ok";
    case "aborted":
      return "test-result--info";
    default:
      return "test-result--error";
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
