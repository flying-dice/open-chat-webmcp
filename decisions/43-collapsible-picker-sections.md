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

## Amendment (2026-09-01) — the disclosure control is a `Command.Item`, not a `<button>`

MR !1's review (card 130) measured, live in Chromium with axe-core, that
this decision's literal `<button aria-expanded>` cannot be placed ANYWHERE
inside `Command.List`'s `role="listbox"` subtree: axe's
`aria-required-children` flags any `role="button"` descendant of a listbox
as a critical violation, at any nesting depth (confirmed even wrapped in a
`role="group"`, which has no owned-elements restriction of its own to stop
the check). A hand-rolled `<div role="group" tabindex="0" aria-expanded>`
satisfies axe but is independently invalid — `svelte-check`'s a11y linter
confirms `group` is a non-interactive role that does not support
`aria-expanded` at all, contrary to what its name suggests. There is no
listbox-permitted role (`option` or `group`) that supports `aria-expanded`.

The disclosure control is now a real `Command.Item` (`role="option"`, the
same primitive every selectable model row already uses) whose activation
(click, Enter via `Command.Root`'s own "activate the highlighted row"
mechanism, or a hand-wired Space) toggles the section instead of picking a
model. State is communicated via the listbox's own visible row count
changing, the way a "Show more" option row does in any real combobox —
there is no formal `aria-expanded` announcement, because no valid element
for one exists in this position. Verified: 0 `aria-required-children`
violations, matching origin/main's baseline. Everything else this decision
specifies — collapsed by default, count in the heading, expand in place on
click, reset on popover close — is unchanged; only the underlying markup
primitive is corrected. See src/sidepanel/components/ModelPicker.svelte's
`collapsibleOption` snippet doc comment for the full measured trail
(including the two designs that were tried and failed) and
boards/project-backlog/130-model-picker-scroll-and-density.md's fourth-pass
gate entry for the live Storybook/axe evidence.
