// Tests for ./page-context-source.ts — the `runtime:get-page-context` round
// trip behind `src/domain/chat`'s `PageContextSource` port (card 118,
// decisions/40-page-context-access.md).
//
// The seam is the same narrow fake over `chrome.runtime.sendMessage` that
// ./tab-sync.test.ts uses: the adapter's entire job is "send one message,
// classify what comes back", so a fake that decides what comes back
// exercises every branch of it without a browser.
//
// What is being pinned here is the ERROR CLASSIFICATION, because that is the
// part card 119's UI will branch on and the part a reader cannot check by
// eye. Three outcomes have to stay distinguishable:
//
//   Restricted   — the tab allows no content script and never will
//                  (chrome://, the Web Store, the PDF viewer). Terminal;
//                  offering a retry would be a lie.
//   Unreachable  — the relay may well be there and did not answer. Retryable.
//   (success)    — including a snapshot with EMPTY text, which is the usual
//                  answer to a selection pull and must not be an error.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageContextSnapshot } from "../../domain/chat";
import { createPageContextSource } from "./page-context-source";
import type { RuntimeGetPageContextRequest, RuntimeGetPageContextResponse } from "./protocol";

type SendMessageImpl = (message: unknown) => Promise<unknown>;

function stubRuntime(impl: SendMessageImpl): { sent: unknown[] } {
  const sent: unknown[] = [];
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn((message: unknown) => {
        sent.push(message);
        return impl(message);
      }),
    },
  } as unknown as typeof chrome);
  return { sent };
}

const SNAPSHOT: PageContextSnapshot = {
  mode: "extract",
  text: "# Title\n\nSome page text.",
  url: "https://example.test/post",
  title: "Title",
  truncated: false,
  bytes: 24,
};

function okResponse(context: PageContextSnapshot, tabId = 7): RuntimeGetPageContextResponse {
  return { type: "runtime:get-page-context-response", tabId, ok: true, restricted: false, context };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createPageContextSource", () => {
  it("sends one runtime:get-page-context carrying the tab and the mode, and returns the snapshot", async () => {
    const { sent } = stubRuntime(async () => okResponse(SNAPSHOT));

    const [snapshot, err] = await createPageContextSource().pull(7, "extract");

    expect(err).toBeUndefined();
    expect(snapshot).toEqual(SNAPSHOT);
    expect(sent).toEqual([
      {
        type: "runtime:get-page-context",
        tabId: 7,
        mode: "extract",
      } satisfies RuntimeGetPageContextRequest,
    ]);
  });

  it("is tab-agnostic — the same source serves whichever tab the panel is tracking now", async () => {
    const { sent } = stubRuntime(async (msg) => {
      const req = msg as RuntimeGetPageContextRequest;
      return okResponse({ ...SNAPSHOT, mode: req.mode }, req.tabId);
    });

    const source = createPageContextSource();
    await source.pull(1, "selection");
    await source.pull(2, "extract");

    expect(sent).toEqual([
      { type: "runtime:get-page-context", tabId: 1, mode: "selection" },
      { type: "runtime:get-page-context", tabId: 2, mode: "extract" },
    ]);
  });

  it("an EMPTY selection is a success, not an error — most pulls find nothing selected", async () => {
    const empty: PageContextSnapshot = {
      mode: "selection",
      text: "",
      url: "https://example.test/",
      title: "Example",
      truncated: false,
      bytes: 0,
    };
    stubRuntime(async () => okResponse(empty));

    const [snapshot, err] = await createPageContextSource().pull(7, "selection");

    expect(err).toBeUndefined();
    expect(snapshot).toEqual(empty);
  });

  it("a truncated extract still succeeds — the flag travels, it is not a failure", async () => {
    stubRuntime(async () => okResponse({ ...SNAPSHOT, truncated: true, bytes: 16_000 }));

    const [snapshot, err] = await createPageContextSource().pull(7, "extract");

    expect(err).toBeUndefined();
    expect(snapshot?.truncated).toBe(true);
  });

  it("restricted:false failures map to Unreachable and carry the worker's description for the log", async () => {
    stubRuntime(async () => ({
      type: "runtime:get-page-context-response",
      tabId: 7,
      ok: false,
      restricted: false,
      error: "Tab 7 did not respond in time — the page may be busy or unresponsive.",
    }));

    const [snapshot, err] = await createPageContextSource().pull(7, "extract");

    expect(snapshot).toBeUndefined();
    expect(err?.kind).toBe("Unreachable");
    expect(err?.message).toContain("did not respond in time");
  });

  it("restricted:true maps to Restricted — a distinct, terminal kind, never folded into Unreachable", async () => {
    stubRuntime(async () => ({
      type: "runtime:get-page-context-response",
      tabId: 7,
      ok: false,
      restricted: true,
      error: "No WebMCP relay is available in tab 7.",
    }));

    const [snapshot, err] = await createPageContextSource().pull(7, "extract");

    expect(snapshot).toBeUndefined();
    expect(err?.kind).toBe("Restricted");
  });

  it("no response at all (a worker with no listener) is Unreachable, never a throw", async () => {
    stubRuntime(async () => undefined);

    const [snapshot, err] = await createPageContextSource().pull(7, "selection");

    expect(snapshot).toBeUndefined();
    expect(err?.kind).toBe("Unreachable");
  });

  it("a rejected sendMessage (worker asleep, context invalidated) is Unreachable with the original on `cause`", async () => {
    const boom = new Error("Extension context invalidated.");
    stubRuntime(async () => {
      return Promise.reject(boom);
    });

    const [snapshot, err] = await createPageContextSource().pull(7, "selection");

    expect(snapshot).toBeUndefined();
    expect(err?.kind).toBe("Unreachable");
    expect(err?.cause).toBe(boom);
  });

  it("ok:true with no context is treated as a failure rather than handed on as a half-built snapshot", async () => {
    stubRuntime(async () => ({
      type: "runtime:get-page-context-response",
      tabId: 7,
      ok: true,
      restricted: false,
    }));

    const [snapshot, err] = await createPageContextSource().pull(7, "extract");

    expect(snapshot).toBeUndefined();
    expect(err?.kind).toBe("Unreachable");
  });

  it("never throws, whatever comes back", async () => {
    for (const response of [
      null,
      42,
      "nope",
      {},
      { type: "runtime:call-tool-response", ok: true },
    ]) {
      stubRuntime(async () => response);
      await expect(createPageContextSource().pull(7, "extract")).resolves.toBeDefined();
      vi.unstubAllGlobals();
    }
  });
});
