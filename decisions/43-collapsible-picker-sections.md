---
status: Accepted
date: 2026-09-01
---
# Decision 43 — The Unverified and No-tool-support sections collapse by default

Refines decisions/22's list order and decisions/06's/[decisions/11](11-provider-capability-detection.md)'s
never-hide rule. Card 130.

## Context

Decision 22's amendment (2026-09-01) fixed the model picker's scroll trap and
tightened row density. That alone still left a real-world case cramped: a
large OpenAI-compatible gateway catalog puts dozens of rows in "Unverified,"
and scrolling past all of them to reach a provider's other groups, or to
"No tool support," is the normal case rather than an edge case.

Jonathan asked to see two live options — everything always expanded and
scrollable, versus the same two sections collapsed by default behind a count
— built as comparable Storybook stories, and picked the collapsible one after
viewing both rendered against a 24-unverified/1-no-tools seed.

## Decision

**The "Unverified" and "No tool support" sections start collapsed, behind a
heading that states their count** (e.g. "Unverified (24)"), and expand in
place on click — a disclosure control (`<button aria-expanded>`), not a
second navigation level. Selectable models grouped by provider are
unaffected and stay always-expanded, since they're usually few and are what
most opens are for.

This is a deliberate reading of decisions/06's and decisions/11's "never
hidden, always shown-with-reason" rule: a collapsed-but-counted section is
still shown — its existence, its size, and (via the heading) that it's
capability-gated are all visible without interaction — only the individual
rows require one click to reach. Nothing is removed from the picker, silently
guessed safe, or omitted from the count. This differs from decision 22's
original always-expanded reading of the same rule, which this decision
supersedes on this one point; decision 22's three-bucket order, the never-
hide rule itself, and the filter threshold are otherwise unchanged.

Collapse state resets to collapsed each time the popover opens (not
persisted per-session), so every open starts from the same condensed view
rather than remembering the last expansion.

## Consequences

- `ModelPicker.test.ts`'s existing coverage of Unverified/No-tool-support
  rows has to open the section (click its disclosure heading) before
  asserting a row is present, rather than finding it directly after render.
- The temporary `sectionDisplay` prop card 130 added purely to render both
  variants side by side in Storybook is deleted now that a variant is
  chosen — collapsible is the only behavior, not a flag.
- If a provider surfaces so few unverified/no-tools models that collapsing
  adds a click for no real space saving, that's accepted as a minor cost of
  one consistent interaction rather than a row-count-dependent special case.
