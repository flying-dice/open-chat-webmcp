// Card 102 (decisions/37-i18n-paraglide.md, decisions/30's unit tier).
//
// The LOCALIZED fallback wrapper over src/domain/providers/capability.ts's
// `reasonForCapability`, which now returns `undefined` for "no detail at
// all" rather than inventing English (see that function's own doc comment).

import { describe, expect, it } from "vitest";
import type { ModelCapabilities } from "../domain/providers";
import { m } from "../paraglide/messages.js";
import { capabilityReason } from "./capabilityMessage";

describe("capabilityReason", () => {
  it("returns undefined when there is no capability yet", () => {
    expect(capabilityReason(undefined)).toBeUndefined();
  });

  it("uses the detail text when status is unknown and detail is present", () => {
    expect(capabilityReason({ status: "unknown", detail: ["Provider returned 500."] })).toBe(
      "Provider returned 500.",
    );
  });

  it("falls back to the localized default when status is unknown with no detail", () => {
    expect(capabilityReason({ status: "unknown" })).toBe(m.capability_unverifiedFallback());
  });

  it("uses the detail text when status is no-tools and detail is present", () => {
    expect(capabilityReason({ status: "no-tools", detail: ["no tools capability reported"] })).toBe(
      "no tools capability reported",
    );
  });

  it("falls back to the localized default when status is no-tools with no detail", () => {
    expect(capabilityReason({ status: "no-tools" })).toBe(m.capability_noToolsFallback());
  });

  it("returns the joined detail for tool-capable when present, else undefined (no fallback)", () => {
    const capable: ModelCapabilities = {
      status: "tool-capable",
      detail: ["confirmed via /api/show"],
    };
    expect(capabilityReason(capable)).toBe("confirmed via /api/show");
    expect(capabilityReason({ status: "tool-capable" })).toBeUndefined();
  });

  it("joins a multi-entry detail array with a space", () => {
    expect(capabilityReason({ status: "no-tools", detail: ["line one", "line two"] })).toBe(
      "line one line two",
    );
  });
});
