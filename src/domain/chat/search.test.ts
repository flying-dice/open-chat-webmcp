import { describe, it, expect } from "vitest";
import { filterChatSummaries } from "./search";
import type { ChatSummary } from "./session";

function summary(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: "c1",
    origin: "https://example.com",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 1,
    toolCallCount: 0,
    ...overrides,
  };
}

describe("filterChatSummaries", () => {
  it("returns every summary, unchanged, for an empty query", () => {
    const summaries = [summary({ id: "a" }), summary({ id: "b" })];
    expect(filterChatSummaries(summaries, "")).toEqual(summaries);
  });

  it("returns every summary for a whitespace-only query", () => {
    const summaries = [summary({ id: "a" })];
    expect(filterChatSummaries(summaries, "   ")).toEqual(summaries);
  });

  it("matches by title", () => {
    const match = summary({ id: "match", title: "Renamed chat about ferrets" });
    const other = summary({ id: "other", title: "Something else entirely" });
    expect(filterChatSummaries([match, other], "ferrets")).toEqual([match]);
  });

  it("matches by origin", () => {
    const match = summary({ id: "match", origin: "https://cooking.example.com" });
    const other = summary({ id: "other", origin: "https://news.example.com" });
    expect(filterChatSummaries([match, other], "cooking")).toEqual([match]);
  });

  it("matches by preview text", () => {
    const match = summary({ id: "match", preview: "how do I roast a chicken" });
    const other = summary({ id: "other", preview: "what's the weather today" });
    expect(filterChatSummaries([match, other], "chicken")).toEqual([match]);
  });

  it("is case-insensitive", () => {
    const match = summary({ id: "match", title: "Ferret Care 101" });
    expect(filterChatSummaries([match], "FERRET")).toEqual([match]);
    expect(filterChatSummaries([match], "ferret")).toEqual([match]);
  });

  it("is diacritic-insensitive", () => {
    const match = summary({ id: "match", title: "Best café in town" });
    expect(filterChatSummaries([match], "cafe")).toEqual([match]);
    expect(filterChatSummaries([match], "café")).toEqual([match]);
  });

  it("matches a substring anywhere in the field, not just a prefix", () => {
    const match = summary({ id: "match", preview: "the quick brown fox" });
    expect(filterChatSummaries([match], "brown")).toEqual([match]);
  });

  it("excludes a summary that matches none of title/origin/preview", () => {
    const summaries = [
      summary({ id: "a", title: "Alpha", origin: "https://a.example.com", preview: "one" }),
    ];
    expect(filterChatSummaries(summaries, "zzz-not-present")).toEqual([]);
  });

  it("never matches a chat's message body — ChatSummary carries no body to search", () => {
    // Documents the boundary rather than exercising it: a ChatSummary has no
    // field beyond title/origin/preview for this function to reach into, so
    // there is no way for it to accidentally search full message content.
    const match = summary({ id: "a", preview: "short preview only" });
    expect(filterChatSummaries([match], "short preview only")).toEqual([match]);
  });

  it("preserves order and does not mutate the input array", () => {
    const summaries = [
      summary({ id: "a", title: "apple pie" }),
      summary({ id: "b", title: "apple crumble" }),
      summary({ id: "c", title: "banana bread" }),
    ];
    const frozen = [...summaries];
    const result = filterChatSummaries(summaries, "apple");
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
    expect(summaries).toEqual(frozen);
  });

  it("falls back to the origin when title and preview are both absent", () => {
    const match = summary({ id: "a", origin: "https://match.example.com" });
    expect(filterChatSummaries([match], "match.example")).toEqual([match]);
  });
});
