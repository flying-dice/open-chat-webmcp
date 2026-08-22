// Tests for the provider-agnostic vocabulary in ./provider.ts: the
// ProviderError -> user copy mapping (describeProviderError) and the
// reserved-header rule (reservedHeaderReason). Zero platform mocks — pure
// functions over plain data (decisions/30-vitest-test-pyramid.md).
import { describe, expect, it, test } from "vitest";
import { describeProviderError, reservedHeaderReason, type ProviderError, type ProviderType } from "./provider";

describe("describeProviderError", () => {
  test.each<[string, ProviderError, string]>([
    [
      "unreachable-or-cors",
      { kind: "unreachable-or-cors", message: "Could not reach http://localhost:11434 — is Ollama running?" },
      "Could not reach http://localhost:11434 — is Ollama running?",
    ],
    ["aborted", { kind: "aborted" }, "Request was cancelled."],
    [
      "auth",
      { kind: "auth", status: 401, message: "Invalid API key" },
      "Authentication failed (401): Invalid API key",
    ],
    [
      "http without a body",
      { kind: "http", status: 500, statusText: "Internal Server Error" },
      "Provider returned 500 Internal Server Error",
    ],
    [
      "http with a body",
      { kind: "http", status: 400, statusText: "Bad Request", body: "model not found" },
      "Provider returned 400 Bad Request: model not found",
    ],
    [
      "not-supported",
      { kind: "not-supported", message: "This provider has no /v1/models endpoint." },
      "This provider has no /v1/models endpoint.",
    ],
    [
      "invalid-response",
      { kind: "invalid-response", message: "unexpected JSON shape" },
      "Provider returned something this extension couldn't understand: unexpected JSON shape",
    ],
  ])("describes %s", (_name, error, expected) => {
    expect(describeProviderError(error)).toBe(expected);
  });

  it("ignores the fix field — unreachable-or-cors's description is the message alone", () => {
    const error: ProviderError = {
      kind: "unreachable-or-cors",
      message: "Could not reach the server.",
      fix: { label: "Set OLLAMA_ORIGINS", command: "OLLAMA_ORIGINS=* ollama serve" },
    };
    expect(describeProviderError(error)).toBe("Could not reach the server.");
  });

  it("produces distinct copy for every kind of ProviderError", () => {
    const errors: ProviderError[] = [
      { kind: "unreachable-or-cors", message: "could not reach the server" },
      { kind: "aborted" },
      { kind: "auth", status: 401, message: "bad key" },
      { kind: "http", status: 500, statusText: "Error" },
      { kind: "not-supported", message: "no models endpoint on this host" },
      { kind: "invalid-response", message: "unparseable body" },
    ];
    const descriptions = errors.map(describeProviderError);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

describe("reservedHeaderReason", () => {
  it("returns undefined for an empty or whitespace-only name", () => {
    expect(reservedHeaderReason("", { type: "ollama", apiKeyConfigured: false })).toBeUndefined();
    expect(reservedHeaderReason("   ", { type: "openai", apiKeyConfigured: true })).toBeUndefined();
  });

  test.each<ProviderType>(["ollama", "openai"])(
    "reserves Content-Type for %s regardless of case",
    (type) => {
      expect(reservedHeaderReason("Content-Type", { type, apiKeyConfigured: false })).toBeDefined();
      expect(reservedHeaderReason("CONTENT-TYPE", { type, apiKeyConfigured: false })).toBeDefined();
      expect(reservedHeaderReason("content-type", { type, apiKeyConfigured: true })).toBeDefined();
    },
  );

  it("reserves Accept only for openai, case-insensitively", () => {
    expect(reservedHeaderReason("Accept", { type: "openai", apiKeyConfigured: false })).toBeDefined();
    expect(reservedHeaderReason("accept", { type: "openai", apiKeyConfigured: true })).toBeDefined();
    expect(reservedHeaderReason("Accept", { type: "ollama", apiKeyConfigured: false })).toBeUndefined();
    expect(reservedHeaderReason("Accept", { type: "ollama", apiKeyConfigured: true })).toBeUndefined();
  });

  it("reserves Authorization only for openai, and only while an API key is configured", () => {
    expect(reservedHeaderReason("Authorization", { type: "openai", apiKeyConfigured: true })).toBeDefined();
    expect(reservedHeaderReason("authorization", { type: "openai", apiKeyConfigured: true })).toBeDefined();
    expect(reservedHeaderReason("Authorization", { type: "openai", apiKeyConfigured: false })).toBeUndefined();
    expect(reservedHeaderReason("Authorization", { type: "ollama", apiKeyConfigured: true })).toBeUndefined();
    expect(reservedHeaderReason("Authorization", { type: "ollama", apiKeyConfigured: false })).toBeUndefined();
  });

  it("does not reserve an arbitrary custom header name", () => {
    expect(reservedHeaderReason("X-My-Header", { type: "openai", apiKeyConfigured: true })).toBeUndefined();
    expect(reservedHeaderReason("X-My-Header", { type: "ollama", apiKeyConfigured: false })).toBeUndefined();
  });
});
