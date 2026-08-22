// Small, reusable `fetch` stubbing helpers shared by the wire-client test
// suites (src/infra/ollama, src/infra/openai, src/infra/mcp) — card 83,
// decisions/30-vitest-test-pyramid.md's "stubbed global fetch (vi.stubGlobal)".
//
// Deliberately NOT under any one `src/infra/<tech>/` folder: unlike
// ../chrome-storage/testing/fake-chrome-storage.ts (which stands in for one
// technology, `chrome.storage`), stubbing `fetch` is common to three
// unrelated tech folders and belongs to none of them. Only ever imported by
// `*.test.ts` files, which — like that fake — are excluded outright from
// `.dependency-cruiser.cjs`'s rules, so this file crossing "tech folder"
// lines is never actually a boundary violation; nothing here is production
// code a real adapter could reach for.

import { vi } from "vitest";

/** Route a stubbed `fetch` by exact request URL — a per-server, per-endpoint OAuth discovery flow issues several distinct GETs, and a single canned response can't tell them apart. Falls back to `notFound()` for anything not registered, so a forgotten route fails loudly rather than hanging. */
export function stubFetchByUrl(
  routes: Record<string, () => Response | Promise<Response>>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes[url];
    if (!route) {
      return new Response(`no stub route registered for ${url}`, { status: 404 });
    }
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Install a single-response `fetch` stub — every call gets the same response. For a sequence of different responses across calls, pass an array; each element is consumed once, in order, and the last one repeats for any call beyond the array's length. */
export function stubFetchSequence(
  responses: (Response | (() => Response | Promise<Response>))[],
): ReturnType<typeof vi.fn> {
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const entry = responses[Math.min(i, responses.length - 1)];
    i++;
    return typeof entry === "function" ? entry() : entry;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
