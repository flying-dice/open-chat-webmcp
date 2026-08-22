// Component tests for SelectionChip.svelte (card 119, decisions/40) — the
// "Selected text" attachment above the composer.
//
// Pure props, like ContextChip: whether the chip EXISTS is the gate store's
// decision (../stores/pageSharing.svelte.test.ts pins the lifecycle); this
// file is about what it shows and what pressing its ✕ does.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import "../../ui/testing/resize-observer";
import SelectionChip from "./SelectionChip.svelte";
import { selectionExcerpt } from "../presentation/sharedContext";
import { m } from "../../paraglide/messages.js";

afterEach(() => cleanup());

describe("SelectionChip", () => {
  it("labels itself and previews the selected text", () => {
    render(SelectionChip, { props: { text: "The quick brown fox", onDismiss: vi.fn() } });

    expect(screen.getByText(m.selectionChip_label())).toBeInTheDocument();
    expect(screen.getByText("The quick brown fox")).toBeInTheDocument();
  });

  it("collapses a multi-line selection into one line and truncates a long one", () => {
    const long = `line one\n\n${"word ".repeat(200)}`;
    render(SelectionChip, { props: { text: long, onDismiss: vi.fn() } });

    const excerpt = selectionExcerpt(long);
    expect(excerpt).not.toContain("\n");
    expect(excerpt.endsWith("…")).toBe(true);
    expect(screen.getByText(excerpt)).toBeInTheDocument();
  });

  // Card 104's RTL pass: the excerpt is page-authored text of unknown
  // direction, so it takes its own from its first strong character rather
  // than inheriting the panel's.
  it("lets the excerpt carry its own writing direction", () => {
    render(SelectionChip, { props: { text: "מה זה אומר", onDismiss: vi.fn() } });

    expect(screen.getByText("מה זה אומר")).toHaveAttribute("dir", "auto");
  });

  it("dismisses through a button with a real accessible name", async () => {
    const onDismiss = vi.fn();
    render(SelectionChip, { props: { text: "some text", onDismiss } });

    await fireEvent.click(screen.getByRole("button", { name: m.selectionChip_removeLabel() }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
