// Tests for the provider-agnostic vocabulary in ./provider.ts: the
// ProviderError -> user copy mapping (describeProviderError) and the
// reserved-header rule (reservedHeaderReason). Zero platform mocks — pure
// functions over plain data (decisions/30-vitest-test-pyramid.md).
import { describe, expect, it, test } from "vitest";
import {
  describeProviderError,
  reservedHeaderReason,
  type ProviderError,
  type ProviderModel,
  type ProviderType,
} from "./provider";
import { fail, ok, type Result } from "../result";

describe("describeProviderError", () => {
  test.each<[string, ProviderError, string]>([
    [
      "unreachable-or-cors",
      {
        kind: "unreachable-or-cors",
        message: "Could not reach http://localhost:11434 — is Ollama running?",
      },
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
    expect(
      reservedHeaderReason("Accept", { type: "openai", apiKeyConfigured: false }),
    ).toBeDefined();
    expect(
      reservedHeaderReason("accept", { type: "openai", apiKeyConfigured: true }),
    ).toBeDefined();
    expect(
      reservedHeaderReason("Accept", { type: "ollama", apiKeyConfigured: false }),
    ).toBeUndefined();
    expect(
      reservedHeaderReason("Accept", { type: "ollama", apiKeyConfigured: true }),
    ).toBeUndefined();
  });

  it("reserves Authorization only for openai, and only while an API key is configured", () => {
    expect(
      reservedHeaderReason("Authorization", { type: "openai", apiKeyConfigured: true }),
    ).toBeDefined();
    expect(
      reservedHeaderReason("authorization", { type: "openai", apiKeyConfigured: true }),
    ).toBeDefined();
    expect(
      reservedHeaderReason("Authorization", { type: "openai", apiKeyConfigured: false }),
    ).toBeUndefined();
    expect(
      reservedHeaderReason("Authorization", { type: "ollama", apiKeyConfigured: true }),
    ).toBeUndefined();
    expect(
      reservedHeaderReason("Authorization", { type: "ollama", apiKeyConfigured: false }),
    ).toBeUndefined();
  });

  it("does not reserve an arbitrary custom header name", () => {
    expect(
      reservedHeaderReason("X-My-Header", { type: "openai", apiKeyConfigured: true }),
    ).toBeUndefined();
    expect(
      reservedHeaderReason("X-My-Header", { type: "ollama", apiKeyConfigured: false }),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Narrowing over the provider vocabulary (card 93, decisions/34)
//
// The `@ts-expect-error` cases below are TYPE tests, not behaviour tests:
// each asserts that a specific misuse is REJECTED by the compiler, so if
// `Result`'s narrowing ever stops applying to `ProviderError` — the classic
// way being someone widening the success arm's error member from the literal
// `undefined` to `ProviderError | undefined`, which kills the discriminant
// (src/domain/result.ts:1-42) — these lines stop erroring and `npm run check`
// fails on the now-unused `@ts-expect-error`. That is the point: the failure
// mode is silent at every CALL site and loud only here.
//
// `ProviderError` is a plain union rather than a class (unlike
// `StorageError`, which src/domain/result.test.ts pins), so it is the case
// where the widened-member mistake is easiest to make by accident: a union
// absorbs `undefined` without any visible change at the declaration.
// ---------------------------------------------------------------------------

/** Stands in for `ChatProvider.listModels` — the real signature, no client behind it. */
async function listModelsResult(failing: boolean): Promise<Result<ProviderModel[], ProviderError>> {
  return failing ? fail({ kind: "auth", status: 401, message: "bad key" }) : ok([]);
}

describe("Result<T, ProviderError> narrowing", () => {
  it("narrows the value side once the error member is checked", async () => {
    const [models, err] = await listModelsResult(false);
    if (err) throw new Error("expected a success");
    // `.length` only typechecks if `models` narrowed to `ProviderModel[]`.
    expect(models.length).toBe(0);
  });

  it("narrows the error to the full ProviderError union, discriminant intact", async () => {
    const [, err] = await listModelsResult(true);
    if (!err) throw new Error("expected a failure");
    // `err.kind` requires `err` to be `ProviderError`, and the inner
    // `err.status` requires the union to still discriminate on `kind`.
    if (err.kind !== "auth") throw new Error(`expected an auth failure, got ${err.kind}`);
    expect(err.status).toBe(401);
  });

  it("does NOT let the models be used before the error is checked", async () => {
    const [models] = await listModelsResult(false);
    // @ts-expect-error `models` is `ProviderModel[] | undefined` until the error member is checked.
    const count: number = models.length;
    expect(count).toBe(0);
  });

  it("does NOT let a ProviderError be read before it is checked", async () => {
    const [, err] = await listModelsResult(true);
    // @ts-expect-error `err` is `ProviderError | undefined` until it is checked.
    const kind: ProviderError["kind"] = err.kind;
    expect(kind).toBe("auth");
  });

  it("does NOT accept a foreign error vocabulary in a provider result", () => {
    // @ts-expect-error `{kind:"quota"}` is not a member of `ProviderError` — a client that hits a failure mode this union does not cover must WIDEN the union, never smuggle a bespoke error through (./provider.ts's header).
    const bad: Result<ProviderModel[], ProviderError> = fail({ kind: "quota" });
    expect(bad[1]).toEqual({ kind: "quota" });
  });

  it("does NOT let a success carry an error as well", () => {
    // @ts-expect-error the success arm's error member is the literal `undefined`; making it carry a `ProviderError` too is what would kill the narrowing every case above depends on.
    const bad: Result<ProviderModel[], ProviderError> = [[], { kind: "aborted" }];
    expect(bad[0]).toEqual([]);
  });
});
