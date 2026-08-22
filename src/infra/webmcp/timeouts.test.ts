// Executable check of the timeout ladder's ordering invariant (card 83).
// ./timeouts.mjs's own header states the invariant in a comment only —
// "Nothing enforces that ordering at compile time — if you change one rung,
// re-check the other two by hand." This test is that check, made automatic:
// it fails the moment a future edit breaks the ordering, instead of relying
// on a human re-reading the comment.

import { describe, expect, it } from "vitest";
import {
  AGENT_LOOP_TOOL_CALL_TIMEOUT_MS,
  RELAY_EXECUTE_TIMEOUT_MS,
  SW_CALL_TIMEOUT_MS,
  SW_PULL_TIMEOUT_MS,
} from "./timeouts.mjs";

describe("timeout ladder ordering invariant", () => {
  it("RELAY_EXECUTE_TIMEOUT_MS < SW_CALL_TIMEOUT_MS < AGENT_LOOP_TOOL_CALL_TIMEOUT_MS", () => {
    expect(RELAY_EXECUTE_TIMEOUT_MS).toBeLessThan(SW_CALL_TIMEOUT_MS);
    expect(SW_CALL_TIMEOUT_MS).toBeLessThan(AGENT_LOOP_TOOL_CALL_TIMEOUT_MS);
  });

  it("each rung leaves a comfortable margin over the one it wraps (not just barely greater)", () => {
    // "Comfortable margin" per the module doc: the innermost timeout error
    // should win the race under real scheduling jitter rather than being
    // masked by an outer layer's generic timeout. A few seconds is the bar
    // — not an exact number, just enough to catch an accidental off-by-a-bit
    // edit that technically preserves ordering but reintroduces the race.
    const MIN_MARGIN_MS = 2_000;
    expect(SW_CALL_TIMEOUT_MS - RELAY_EXECUTE_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_MARGIN_MS);
    expect(AGENT_LOOP_TOOL_CALL_TIMEOUT_MS - SW_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(
      MIN_MARGIN_MS,
    );
  });

  it("all three rungs are positive, finite numbers (a stray 0/NaN/negative would silently defeat the whole ladder)", () => {
    for (const ms of [
      RELAY_EXECUTE_TIMEOUT_MS,
      SW_CALL_TIMEOUT_MS,
      AGENT_LOOP_TOOL_CALL_TIMEOUT_MS,
    ]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });

  it("SW_PULL_TIMEOUT_MS is a separate registry-rebuild budget, not part of the call-timeout ordering", () => {
    // Documented explicitly in ./timeouts.mjs as unrelated to the ladder
    // above — asserted here only so a future refactor that folds it into
    // the ladder trips this test and has to make that decision on purpose.
    expect(SW_PULL_TIMEOUT_MS).toBeLessThan(RELAY_EXECUTE_TIMEOUT_MS);
  });
});
