// @vitest-environment jsdom
//
// The relay's LIVE SELECTION PINGS (card 129,
// boards/project-backlog/129-live-selection-chip.md, decisions/40's "Live
// chip updates").
//
// WHAT IS UNDER TEST. `src/content/relay.ts` is a composition root: it
// exports nothing and wires its listeners as a side effect of being imported.
// The seam this file uses is the one src/background/sw.test.ts and
// src/infra/chrome-runtime/tab-sync.test.ts already established for exactly
// that shape — install a fake `chrome` global BEFORE importing the module,
// then read what the relay sent. What is DRIVEN, though, is a real DOM: these
// tests move a real `Selection` and let the platform fire the event, rather
// than dispatching a synthetic one.
//
// WHY jsdom. The relay is the one module in this extension that touches a
// visited page, and the behaviour this card added is a `document`
// `selectionchange` listener over that page's selection. The "domain" Vitest
// project runs on node for good reasons (vitest.config.ts); the per-file
// docblock above scopes jsdom to this file, the same exception
// src/infra/dom/page-extraction.test.ts takes.
//
// JSDOM AND `selectionchange` — MEASURED, not assumed (card 129), with one
// limitation worth writing down because it bounds what is proved here:
//
//   - DOCUMENT selections: jsdom 30 fires `selectionchange` on every change,
//     so every test below except one drives a real range and lets the
//     platform fire the event. Nothing synthetic.
//   - FORM CONTROL selections: jsdom fires it for the FIRST change on a
//     focused `<input>` and then goes quiet — measured while writing this
//     file: three successive `setSelectionRange` calls produce exactly one
//     event. Chrome fires one per change (the document `selectionchange`
//     covering form controls is the measured behaviour `formControlSelection`
//     in src/infra/dom/page-extraction.ts was written for). So the first half
//     of the form-control test below is real, and the EXTENSION half
//     dispatches the event by hand, standing in for the one jsdom declines to
//     send.
//
// What jsdom cannot say anything about at all is Chrome's own firing cadence
// during a real mouse drag. That is covered where it can only be covered, in
// a real browser: verify/checks/sharingGateScenario.mjs selects on the demo
// page with NO panel interaction at all and waits for the chip to appear and
// then to change.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Everything the relay pushed to the worker, in order. */
let sent: { type: string; [k: string]: unknown }[] = [];

/** Installs a fake `chrome` whose `sendMessage` records and resolves. Re-stubbable per test: the relay reads the global at call time, not at import. */
function installFakeChrome(sendMessage: (message: { type: string }) => Promise<unknown>): void {
  const fake = {
    runtime: {
      sendMessage,
      onMessage: { addListener: () => undefined },
    },
  } as unknown as typeof chrome;
  vi.stubGlobal("chrome", fake);
}

/** Just the selection pings — the relay also pushes one `runtime:tools-updated` at load (WebMCP is absent under jsdom). */
function pings(): { type: string; [k: string]: unknown }[] {
  return sent.filter((m) => m.type === "runtime:selection-changed");
}

/**
 * Import the relay ONCE for the whole file.
 *
 * Deliberately not the `vi.resetModules()`-per-test seam sw.test.ts uses, and
 * the reason is jsdom rather than preference: re-importing re-runs the
 * module's `document.addEventListener("selectionchange", …)` against the SAME
 * jsdom document, and nothing detaches the previous instance's listener — the
 * relay has no teardown, because a content script's document dying IS its
 * teardown. Ten imports would mean ten live relays all pinging at once. So
 * the module is loaded once and each test starts from a normalised state
 * instead (`resetRelayState`): nothing selected, the change-detector's
 * last-reported identity back at `""`, and nothing recorded.
 */
async function loadRelay(): Promise<void> {
  await import("./relay");
}

/** Past the relay's SELECTION_DEBOUNCE_MS (150ms) with room to spare. */
function settle(): void {
  vi.advanceTimersByTime(200);
}

/** Bring the loaded relay back to "nothing is selected, and it knows that", then forget everything it said getting there. */
function resetRelayState(): void {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  settle();
  sent = [];
}

/** Select the first `chars` characters of a fresh paragraph (all of it by default) — a real range, whose real `selectionchange` the relay hears. */
function selectTarget(text: string, chars?: number): void {
  document.body.innerHTML = `<p id="target">${text}</p>`;
  const target = document.getElementById("target");
  const selection = window.getSelection();
  selection?.removeAllRanges();
  const range = document.createRange();
  range.setStart(target!.firstChild!, 0);
  range.setEnd(target!.firstChild!, chars ?? text.length);
  selection?.addRange(range);
}

beforeEach(async () => {
  sent = [];
  vi.useFakeTimers();
  installFakeChrome((message) => {
    sent.push(message);
    return Promise.resolve(undefined);
  });
  await loadRelay();
  resetRelayState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the relay's selection ping", () => {
  it("pings once when a selection settles, carrying NO text — only the type and the tab-id sentinel", () => {
    selectTarget("the sentence the user highlighted");
    settle();

    expect(pings()).toEqual([{ type: "runtime:selection-changed", tabId: -1 }]);
  });

  it("says nothing until the selection has SETTLED", () => {
    selectTarget("the sentence the user highlighted");
    vi.advanceTimersByTime(100); // still inside the settle window
    expect(pings()).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(pings()).toHaveLength(1);
  });

  it("debounces a drag: the many changes one gesture makes produce ONE ping", () => {
    // What a mouse drag across a paragraph looks like from the DOM's side —
    // the focus edge moving character by character, each one a
    // `selectionchange`.
    for (let chars = 1; chars <= 20; chars += 1) {
      selectTarget("one two three four five", chars);
      vi.advanceTimersByTime(10);
    }
    settle();

    expect(pings()).toHaveLength(1);
  });

  it("does not ping when the settled selection is the SAME one it last reported — a re-selection, or a click that does not move it, is not news", () => {
    selectTarget("the sentence the user highlighted");
    settle();
    expect(pings()).toHaveLength(1);

    // The page re-applies an identical range (SPAs do this on re-render), and
    // the relay stays quiet: the worker and the panel are not woken to be
    // told nothing changed.
    selectTarget("the sentence the user highlighted");
    settle();
    selectTarget("the sentence the user highlighted");
    settle();

    expect(pings()).toHaveLength(1);
  });

  it("pings for each EXTENSION of a selection — the shift+arrow case, where the anchor never moves and only the length grows", () => {
    for (const chars of [4, 9, 15, 22]) {
      selectTarget("one two three four five", chars);
      settle();
    }
    expect(pings()).toHaveLength(4);
  });

  it("pings when the selection is CLEARED, so a chip for a selection the user has dropped goes away on its own", () => {
    selectTarget("the sentence the user highlighted");
    settle();
    expect(pings()).toHaveLength(1);

    window.getSelection()?.removeAllRanges();
    settle();

    expect(pings()).toHaveLength(2);
  });

  it("never pings for a selection below the minimum length — the ping and the chip agree on what counts as a selection", () => {
    selectTarget("ab");
    settle();
    expect(pings()).toEqual([]);

    // ...and the third character is what makes it worth reporting.
    selectTarget("abc");
    settle();
    expect(pings()).toHaveLength(1);
  });

  it("covers a selection inside a FORM CONTROL through the same one listener — no second listener, and no `input`-specific path", () => {
    const input = document.createElement("input");
    input.value = "Hello world";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 5);
    settle();
    expect(pings()).toHaveLength(1);

    // Extending it inside the control is a change like any other — but jsdom
    // will not fire a SECOND `selectionchange` for the same input (see the
    // module note), so the event Chrome would send is dispatched here. What
    // is being pinned is the relay's reaction to it: the new identity differs,
    // so it pings again.
    input.setSelectionRange(0, 11);
    document.dispatchEvent(new Event("selectionchange"));
    settle();
    expect(pings()).toHaveLength(2);
  });

  it("never pings for a selection inside a PASSWORD field — the pull would refuse to read it, so there is nothing to tell the panel about", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "hunter2!";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 8);
    settle();

    expect(pings()).toEqual([]);
  });

  it("survives a worker that is not listening — a rejected sendMessage must never break the page's own event loop", () => {
    installFakeChrome((message) => {
      sent.push(message);
      return Promise.reject(new Error("Receiving end does not exist."));
    });

    selectTarget("the sentence the user highlighted");
    expect(() => settle()).not.toThrow();
    expect(pings()).toHaveLength(1);
  });
});
