// Tests for the reserved-header rule in ./servers.ts (card 107,
// decisions/15-custom-headers-are-credentials.md). Zero platform mocks —
// pure function over plain data (decisions/30-vitest-test-pyramid.md). Mirrors
// src/domain/providers/provider.test.ts's `reservedHeaderReason` coverage for
// the sibling rule.
import { describe, expect, it } from "vitest";
import { validateServerHeaders } from "./servers";

describe("validateServerHeaders", () => {
  it("returns no issues for undefined or an empty headers map", () => {
    expect(validateServerHeaders(undefined)).toEqual([]);
    expect(validateServerHeaders({})).toEqual([]);
  });

  it("flags content-type and accept as client-controlled, case-insensitively, keeping the typed casing", () => {
    expect(validateServerHeaders({ "Content-Type": "application/json" })).toEqual([
      { header: "Content-Type", code: "client-controlled" },
    ]);
    expect(validateServerHeaders({ ACCEPT: "text/event-stream" })).toEqual([
      { header: "ACCEPT", code: "client-controlled" },
    ]);
  });

  it("does not flag authorization when no auth token is configured", () => {
    expect(validateServerHeaders({ Authorization: "Bearer x" })).toEqual([]);
    expect(validateServerHeaders({ Authorization: "Bearer x" }, { hasAuthToken: false })).toEqual(
      [],
    );
  });

  it("flags authorization as authorization-bearer-token only while a token is configured", () => {
    expect(validateServerHeaders({ Authorization: "Bearer x" }, { hasAuthToken: true })).toEqual([
      { header: "Authorization", code: "authorization-bearer-token" },
    ]);
    expect(validateServerHeaders({ authorization: "Bearer x" }, { hasAuthToken: true })).toEqual([
      { header: "authorization", code: "authorization-bearer-token" },
    ]);
  });

  it("does not flag an arbitrary custom header name", () => {
    expect(validateServerHeaders({ "x-tenant-id": "acme" }, { hasAuthToken: true })).toEqual([]);
  });

  it("returns one issue per offending header, not just the first", () => {
    expect(
      validateServerHeaders(
        { "Content-Type": "application/json", Authorization: "Bearer x", "x-tenant-id": "acme" },
        { hasAuthToken: true },
      ),
    ).toEqual([
      { header: "Content-Type", code: "client-controlled" },
      { header: "Authorization", code: "authorization-bearer-token" },
    ]);
  });
});
