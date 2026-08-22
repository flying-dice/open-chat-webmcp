// Card 95 (decisions/34-errors-as-values.md, decisions/30's unit tier).
//
// The panel's notice channel is three functions over one array, and exactly
// one of them has a rule worth pinning: the de-duplication. Retrying a failing
// action is the ordinary case — pick the model again, rename again — and three
// copies of one sentence reads as three different problems.
//
// A `.svelte.ts` module under Vitest's Svelte plugin, same as
// ./approvals.svelte.test.ts: the runes compile, and `clearNotices` in a
// `beforeEach` is what keeps the module-level state from leaking between
// tests.

import { beforeEach, describe, expect, it } from "vitest";
import { clearNotices, dismissNotice, panelNotices, reportNotice } from "./notices.svelte";

beforeEach(() => {
  clearNotices();
});

describe("panel notices", () => {
  it("shows notices in the order they were reported", () => {
    reportNotice("first");
    reportNotice("second");

    expect(panelNotices.all.map((n) => n.message)).toEqual(["first", "second"]);
  });

  it("does not stack a message that is already on screen", () => {
    reportNotice("Couldn't save your model choice — try again.");
    reportNotice("Couldn't save your model choice — try again.");

    expect(panelNotices.all).toHaveLength(1);
  });

  it("shows it again once the user has dismissed it — a second failure IS news", () => {
    reportNotice("same message");
    const id = panelNotices.all[0]!.id;
    dismissNotice(id);
    reportNotice("same message");

    expect(panelNotices.all).toHaveLength(1);
    expect(panelNotices.all[0]!.id).not.toBe(id);
  });

  it("dismisses only the notice asked for", () => {
    reportNotice("keep me");
    reportNotice("drop me");
    const target = panelNotices.all.find((n) => n.message === "drop me")!;

    dismissNotice(target.id);

    expect(panelNotices.all.map((n) => n.message)).toEqual(["keep me"]);
  });

  it("ignores a dismiss for an id that is not there", () => {
    reportNotice("keep me");
    dismissNotice("notice-does-not-exist");
    expect(panelNotices.all).toHaveLength(1);
  });
});
