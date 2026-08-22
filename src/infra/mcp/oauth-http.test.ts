// Tests for the two OAuth request shapes and their failure mapping — the
// metadata GET and the form-encoded token POST (card 83).

import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFetchError, fetchJson, postToken } from "./oauth-http";
import { jsonResponse } from "../testing/fetch-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyFetchError", () => {
  it("a timeout/abort DOMException maps to kind 'timeout'", () => {
    const error = classifyFetchError(new DOMException("timed out", "TimeoutError"));
    expect(error.kind).toBe("timeout");
  });

  it("a bare TypeError maps to kind 'unreachable'", () => {
    const error = classifyFetchError(new TypeError("Failed to fetch"));
    expect(error.kind).toBe("unreachable");
  });

  it("anything else maps to invalid-response with the error's message", () => {
    const error = classifyFetchError(new Error("weird"));
    expect(error).toEqual({ kind: "invalid-response", message: "weird" });
  });
});

describe("fetchJson", () => {
  it("returns the parsed JSON body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ a: 1 })),
    );
    await expect(fetchJson("https://x.example")).resolves.toEqual([{ a: 1 }, undefined]);
  });

  it("maps a non-2xx response to not-mcp-endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" })),
    );
    const result = await fetchJson("https://x.example");
    expect(result).toEqual([
      undefined,
      { kind: "not-mcp-endpoint", message: "https://x.example responded 404 Not Found." },
    ]);
  });

  it("maps a malformed JSON body to invalid-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    const [, error] = await fetchJson("https://x.example");
    expect(error).toBeDefined();
    expect(error?.kind).toBe("invalid-response");
  });

  it("maps a network failure to the classified fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await fetchJson("https://x.example");
    expect(result).toEqual([
      undefined,
      { kind: "unreachable", message: expect.stringContaining("Could not reach") },
    ]);
  });
});

describe("postToken", () => {
  it("POSTs form-encoded and returns the parsed JSON on 2xx", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ access_token: "at-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postToken(
      "https://as.example/token",
      new URLSearchParams({ grant_type: "refresh_token" }),
    );

    expect(result).toEqual([{ access_token: "at-1" }, undefined]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(init.body).toBe("grant_type=refresh_token");
  });

  it("maps RFC 6749 §5.2's {error, error_description} body on a non-2xx to kind 'auth'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "Refresh token expired" }),
            {
              status: 400,
            },
          ),
      ),
    );
    const result = await postToken("https://as.example/token", new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "auth", status: 400, message: "Refresh token expired" },
    ]);
  });

  it("falls back to naming the error code when there's no error_description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
    );
    const result = await postToken("https://as.example/token", new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "auth", status: 400, message: "Token request failed: invalid_grant" },
    ]);
  });

  it("a non-2xx with a non-JSON body still classifies as kind 'auth' with a generic message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 401, statusText: "Unauthorized" })),
    );
    const result = await postToken("https://as.example/token", new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "auth", status: 401, message: "Token endpoint responded 401 Unauthorized." },
    ]);
  });

  it("a 2xx with a non-JSON body maps to invalid-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    const result = await postToken("https://as.example/token", new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "invalid-response", message: "Token endpoint did not return valid JSON." },
    ]);
  });

  it("a network failure maps through classifyFetchError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const [, error] = await postToken("https://as.example/token", new URLSearchParams());
    expect(error).toBeDefined();
    expect(error?.kind).toBe("timeout");
  });
});
