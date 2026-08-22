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
import { StorageError } from "../../domain/storage";
import { storageFailureMessage } from "../../ui/storageMessage";
import { m } from "../../paraglide/messages.js";
import {
  clearNoticeByKey,
  clearNotices,
  dismissNotice,
  panelNotices,
  reportNotice,
} from "./notices.svelte";

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

// Card 106: the persistent "this conversation isn't being saved" notice
// (src/domain/chat/service.ts's "transcript-write" StorageFailureReport,
// routed by src/sidepanel/main.ts) needs a de-dup/clear rule the plain
// text-based one above doesn't cover — the failures it collapses are not
// guaranteed to share exact wording (a quota failure, then an unexpected
// one), and the event that retracts it is a SUCCESS, which has no message to
// match against at all.
describe("keyed notices", () => {
  it("collapses a run of failures under the same key into one notice, even when the wording changes between attempts", () => {
    reportNotice("Couldn't save this chat: the browser's storage didn't accept it.", "unsaved");
    reportNotice("Couldn't save this chat: the browser's storage failed unexpectedly.", "unsaved");
    reportNotice("Couldn't save this chat: the browser's storage didn't accept it.", "unsaved");

    expect(panelNotices.all).toHaveLength(1);
    expect(panelNotices.all[0]!.message).toBe(
      "Couldn't save this chat: the browser's storage didn't accept it.",
    );
  });

  it("keeps the same id across a keyed update, so a caller holding it is not left pointing at a stale notice", () => {
    reportNotice("first wording", "unsaved");
    const id = panelNotices.all[0]!.id;
    reportNotice("second wording", "unsaved");

    expect(panelNotices.all).toHaveLength(1);
    expect(panelNotices.all[0]!.id).toBe(id);
  });

  it("clearNoticeByKey retracts exactly the notice reported under that key — the auto-clear-on-success path", () => {
    reportNotice("keep me");
    reportNotice("Couldn't save this chat.", "unsaved");

    clearNoticeByKey("unsaved");

    expect(panelNotices.all.map((n) => n.message)).toEqual(["keep me"]);
  });

  it("is a no-op when nothing is up under that key (including after the person already dismissed it)", () => {
    reportNotice("keep me");
    clearNoticeByKey("unsaved");
    expect(panelNotices.all).toHaveLength(1);
  });

  it("a dismissed keyed notice can be shown again — a later failure IS news even though the key repeats", () => {
    reportNotice("Couldn't save this chat.", "unsaved");
    const id = panelNotices.all[0]!.id;
    dismissNotice(id);

    reportNotice("Couldn't save this chat.", "unsaved");

    expect(panelNotices.all).toHaveLength(1);
    expect(panelNotices.all[0]!.id).not.toBe(id);
  });

  it("carries the localized 'unsaved chat' copy end to end through storageFailureMessage", () => {
    const err = new StorageError("Unavailable", "QuotaExceededError: quota exceeded");
    reportNotice(storageFailureMessage(m.app_transcriptSaveFailedWhat(), err), "unsaved");

    expect(panelNotices.all[0]!.message).toBe(
      "Couldn't save this chat: the browser's storage didn't accept it, which usually means it's full, or that the extension was just updated or reloaded. Try again in a moment.",
    );
  });
});
