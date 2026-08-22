// Tests for the two OAuth request shapes and their failure mapping — the
// metadata GET and the form-encoded token POST (card 83).
//
// Card 111 (boards/project-backlog/111-realistic-adapter-tests.md):
// `fetchJson`/`postToken`'s HTTP-status-classification and RFC 6749 §5.2
// error-body-parsing tests now run against a REAL `node:http` server
// (../testing/http-test-server.ts) — a real status/statusText pair and a
// real form-encoded body actually crossing a socket. `classifyFetchError`'s
// own tests stay on hand-built exceptions: they construct a bare
// `TypeError`/`DOMException` directly and pass it straight to a pure
// function — there is no `fetch` call and no wire behaviour anywhere in
// them, so a real server would add nothing but a network round trip neither
// test needs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFetchError, fetchJson, postToken } from "./oauth-http";
import { startHttpTestServer, useHttpTestServer } from "../testing/http-test-server";

afterEach(() => {
  vi.unstubAllGlobals();
});

const server = useHttpTestServer();

// KEPT: pure function, pure input — a hand-built exception is the sharpest
// possible test here, not a stand-in for a real one.
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
  // PORTED: a real 200 with a real JSON body.
  it("returns the parsed JSON body on success, against a real server", async () => {
    server().route("GET", "/", ({ res }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ a: 1 }));
    });
    await expect(fetchJson(server().baseUrl)).resolves.toEqual([{ a: 1 }, undefined]);
  });

  // PORTED: a real 404 with Node's own default statusText, proving the
  // message is built from what actually arrived on the wire.
  it("maps a non-2xx response to not-mcp-endpoint, against a real server", async () => {
    server().route("GET", "/", ({ res }) => {
      res.writeHead(404, "Not Found");
      res.end();
    });
    const result = await fetchJson(server().baseUrl);
    expect(result).toEqual([
      undefined,
      { kind: "not-mcp-endpoint", message: `${server().baseUrl} responded 404 Not Found.` },
    ]);
  });

  // PORTED: a real 200 whose body fails JSON.parse.
  it("maps a malformed JSON body to invalid-response, against a real server", async () => {
    server().route("GET", "/", ({ res }) => {
      res.writeHead(200);
      res.end("not json");
    });
    const [, error] = await fetchJson(server().baseUrl);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("invalid-response");
  });

  // PORTED: a genuinely dead server (nothing listening) rather than a
  // hand-thrown TypeError — the real ECONNREFUSED path `fetch` takes,
  // proving `classifyFetchError` handles undici's actual rejection.
  it("maps a real dead-server connection failure to the classified fetch error", async () => {
    const dead = await startHttpTestServer();
    const baseUrl = dead.baseUrl;
    await dead.close();
    const result = await fetchJson(baseUrl);
    expect(result).toEqual([
      undefined,
      { kind: "unreachable", message: expect.stringContaining("Could not reach") },
    ]);
  });
});

describe("postToken", () => {
  // PORTED: proves the request really is form-encoded on the wire — a
  // stubbed `fetch` can assert the same `init.body`/`init.headers` shape but
  // can't prove the bytes actually round-tripped a socket as
  // `application/x-www-form-urlencoded`.
  it("POSTs form-encoded and returns the parsed JSON on 2xx, against a real server", async () => {
    server().route("POST", "/token", ({ res, body }) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "at-1", receivedBody: body.toString() }));
    });

    const result = await postToken(
      `${server().baseUrl}/token`,
      new URLSearchParams({ grant_type: "refresh_token" }),
    );

    expect(result).toEqual([
      { access_token: "at-1", receivedBody: "grant_type=refresh_token" },
      undefined,
    ]);
    const [request] = server().requests;
    expect(request?.method).toBe("POST");
    expect(request?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(request?.body.toString()).toBe("grant_type=refresh_token");
  });

  // PORTED: a real 400 with a real RFC 6749 §5.2 error body.
  it("maps RFC 6749 §5.2's {error, error_description} body on a non-2xx to kind 'auth', against a real server", async () => {
    server().route("POST", "/token", ({ res }) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "invalid_grant", error_description: "Refresh token expired" }),
      );
    });
    const result = await postToken(`${server().baseUrl}/token`, new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "auth", status: 400, message: "Refresh token expired" },
    ]);
  });

  // PORTED: same real 400, no error_description this time.
  it("falls back to naming the error code when there's no error_description, against a real server", async () => {
    server().route("POST", "/token", ({ res }) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
    });
    const result = await postToken(`${server().baseUrl}/token`, new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "auth", status: 400, message: "Token request failed: invalid_grant" },
    ]);
  });

  // PORTED: a real 401 with a real non-JSON body and Node's own statusText.
  it("a non-2xx with a non-JSON body still classifies as kind 'auth' with a generic message, against a real server", async () => {
    server().route("POST", "/token", ({ res }) => {
      res.writeHead(401, "Unauthorized");
      res.end("not json");
    });
    const result = await postToken(`${server().baseUrl}/token`, new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "auth", status: 401, message: "Token endpoint responded 401 Unauthorized." },
    ]);
  });

  // PORTED: a real 200 whose body fails JSON.parse.
  it("a 2xx with a non-JSON body maps to invalid-response, against a real server", async () => {
    server().route("POST", "/token", ({ res }) => {
      res.writeHead(200);
      res.end("not json");
    });
    const result = await postToken(`${server().baseUrl}/token`, new URLSearchParams());
    expect(result).toEqual([
      undefined,
      { kind: "invalid-response", message: "Token endpoint did not return valid JSON." },
    ]);
  });

  // KEPT: `AbortSignal.timeout(...)` firing before a real server ever
  // responds is exactly the internal DOMException shape `classifyFetchError`
  // already has its own dedicated (and realistic) unit test for above — a
  // hand-thrown one here is not standing in for any wire behaviour, just
  // confirming `postToken` routes its catch through the same function.
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
