// Card 102 (decisions/37-i18n-paraglide.md, decisions/30's unit tier).
//
// The LOCALIZED twin of src/domain/providers/provider.ts's own (English,
// domain-internal) `describeProviderError` — see that function's doc
// comment, and this file's own header comment, for why two implementations
// of the same shape exist. This suite asserts the wording via `m.key()`
// (per the checklist), not literal English, so a copy edit doesn't silently
// break it.

import { describe, expect, it } from "vitest";
import type { ProviderError } from "../domain/providers";
import { m } from "../paraglide/messages.js";
import { describeProviderError } from "./providerMessage";

describe("describeProviderError (UI-side, localized)", () => {
  it("passes an unreachable-or-cors error's own message straight through", () => {
    const error: ProviderError = { kind: "unreachable-or-cors", message: "Could not reach it." };
    expect(describeProviderError(error)).toBe("Could not reach it.");
  });

  it("says the request was cancelled for an aborted error", () => {
    expect(describeProviderError({ kind: "aborted" })).toBe(m.provider_requestCancelled());
  });

  it("formats an auth failure with the status and message", () => {
    const error: ProviderError = { kind: "auth", status: 401, message: "bad key" };
    expect(describeProviderError(error)).toBe(
      m.provider_authFailed({ status: 401, message: "bad key" }),
    );
  });

  it("formats an http error, with the body appended only when present", () => {
    const withBody: ProviderError = {
      kind: "http",
      status: 500,
      statusText: "Internal Server Error",
      body: "oops",
    };
    expect(describeProviderError(withBody)).toBe(
      m.provider_httpError({ status: 500, statusText: "Internal Server Error", detail: ": oops" }),
    );
    const withoutBody: ProviderError = { kind: "http", status: 500, statusText: "Server Error" };
    expect(describeProviderError(withoutBody)).toBe(
      m.provider_httpError({ status: 500, statusText: "Server Error", detail: "" }),
    );
  });

  it("passes a not-supported error's own message straight through", () => {
    const error: ProviderError = { kind: "not-supported", message: "no /v1/models here" };
    expect(describeProviderError(error)).toBe("no /v1/models here");
  });

  it("wraps an invalid-response error's message", () => {
    const error: ProviderError = { kind: "invalid-response", message: "not JSON" };
    expect(describeProviderError(error)).toBe(m.provider_invalidResponse({ message: "not JSON" }));
  });
});
