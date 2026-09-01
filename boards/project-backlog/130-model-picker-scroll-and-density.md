---
column: review
agent: claude-sonnet
live: false
labels: [frontend, bug]
priority: high
updatedAt: 2026-09-01T21:05:00.000Z
---
# Model picker: fix scroll trap, denser list UX

The composer's model picker (decisions/22) can't scroll: `Command.Root` is a
`flex-1` child with no `min-h-0` inside `Popover.Content`'s bounded flex
column, so it grows to its content's full height instead of shrinking, and
`Command.List`'s `overflow-y-auto` never has anything to scroll within. Hit
in real use with a large gateway catalog where the "Unverified" bucket
(decisions/11) has dozens of rows and swallows the whole popover. See
decisions/22's 2026-09-01 amendment for the root cause and the fix.

Also does a density pass (tighter rows, shared `Badge` component for the
capability tag, sticky section headings within the one scroll region), and
builds two Storybook-comparable variants of how the Unverified/No-tool-
support sections display — always-expanded vs. collapsible-with-count — for
Jonathan to pick between live in Storybook before either becomes the shipped
behavior. The losing variant and its temporary prop get deleted afterward;
this is a comparison aid, not a permanent feature flag.

## Checklist

- [x] `min-h-0` fix on `Command.Root`/`Command.List`; list genuinely
      scrollable regardless of section size
- [x] Row density pass: tighter padding/line-height, `Badge` component for
      the capability tag
- [x] Sticky section headings in `command-group.svelte` (local edit, this
      card, since `ModelPicker` is the only consumer)
- [x] New "many unverified models" seed + two comparison stories in
      `ModelPicker.stories.svelte` (always-expanded vs. collapsible)
- [x] New `ModelPicker.test.ts` case: large Unverified bucket still renders
      every row (never-hidden regression guard)
- [x] Live Storybook check in a real browser confirming actual scroll
      behavior (jsdom can't prove this)
- [x] Jonathan picks a variant; losing branch + temporary prop removed —
      picked collapsible sections (decisions/43-collapsible-picker-sections.md).
      Deleted the `sectionDisplay` prop and its Props interface, and the
      always-expanded branches for both sections, from
      src/sidepanel/components/ModelPicker.svelte; deleted the "always
      expanded" comparison `<Story>` from
      src/sidepanel/components/ModelPicker.stories.svelte
- [x] If collapsible picked: new decision record + i18n keys across all
      locales, `npm run guard:i18n` green — decisions/43 recorded; no i18n
      key was needed after all, confirmed by `npm run guard:i18n` staying at
      446 keys x 10 locales unchanged (the collapsed-heading count composes
      `m.providerPicker_unverifiedHeading()`/`m.providerPicker_noToolSupportHeading()`
      with the row count client-side, per decisions/43)
- [x] `npm test`, `npm run check`, `npm run guard`, `npm run build`,
      `npm run verify` all green

## Gates

- [x] tests-passing — `npm test`: 81 files, 1325 tests, all green (incl. the
      new 24-row Unverified regression test) (claude-sonnet, 2026-09-01T19:52:00Z)
- [x] typecheck — `npm run check`: svelte-check 2077 files, 0 errors/0
      warnings; `tsc -p tsconfig.node.json` clean (claude-sonnet, 2026-09-01T19:52:00Z)
- [x] guard — `npm run guard`: all seven sub-guards green (biome, boundaries,
      clean-code — nothing new above the 0.5 threshold, return-types, throws,
      i18n — 446 keys x 10 locales unchanged, stories — 44/44 covered)
      (claude-sonnet, 2026-09-01T19:53:00Z)
- [x] build — `npm run build`: vite build clean, no errors (claude-sonnet,
      2026-09-01T19:53:30Z)
- [x] verify — `npm run verify`: 10/10 required checks + both best-effort
      checks (screenshots, axe — 0 blocking violations) passed against the
      real built extension in Chrome for Testing (claude-sonnet,
      2026-09-01T19:56:00Z)
- [x] live-storybook-check — navigated both new stories in a real Chromium
      (Playwright) at http://localhost:6006: confirmed genuine scroll in
      "Many unverified models — always expanded" (`Command.List.scrollHeight`
      1650 vs `clientHeight` 346, `scrollTop` actually moves, reached the
      bottom "No tool support" row), and confirmed independent expand/collapse
      with correct counts in "Many unverified models — collapsible sections"
      (claude-sonnet, 2026-09-01T18:50:45Z)

Second pass, making collapsible the only behavior (decisions/43):

- [x] tests-passing — `npm test`: 81 files, 1326 tests, all green (incl. the
      updated collapsed-by-default coverage and a new dedicated
      collapse/expand test) (claude-sonnet, 2026-09-01T20:23:00Z)
- [x] typecheck — `npm run check`: svelte-check 1631 files, 0 errors/0
      warnings; `tsc -p tsconfig.node.json` clean (claude-sonnet,
      2026-09-01T20:24:00Z)
- [x] guard — `npm run guard`: all seven sub-guards green (biome, boundaries,
      clean-code — nothing new above the 0.5 threshold, return-types, throws,
      i18n — 446 keys x 10 locales unchanged confirming no new key was
      needed, stories — 44/44 covered) (claude-sonnet, 2026-09-01T20:25:00Z)
- [x] build — `npm run build`: vite build clean, no errors (claude-sonnet,
      2026-09-01T20:26:00Z)
- [x] verify — `npm run verify`: 10/10 required checks + both best-effort
      checks (screenshots, axe — 0 blocking violations) passed against the
      real built extension in Chrome for Testing (claude-sonnet,
      2026-09-01T20:30:00Z)
- [x] live-storybook-check — navigated the renamed
      "Many unverified models (large gateway catalog)" story in a real
      Chromium (Playwright) at http://localhost:6008: confirmed both
      sections render collapsed by default with the right counts in the
      heading ("Unverified (24)", "No tool support (1)"), and that clicking
      each sets `aria-expanded="true"` and independently reveals its rows
      (25 options after expanding Unverified, 26 after also expanding No
      tool support) (claude-sonnet, 2026-09-01T20:33:00Z)

Third pass, three code-review fixes on the review-column diff (filter
auto-expand, badge default color, collapsible-heading accessible name):

- [x] tests-passing — `npm test`: 81 files, 1327 tests, all green (incl. the
      new filter-auto-expand test) (claude-sonnet, 2026-09-01T19:45:00Z)
- [x] typecheck — `npm run check`: svelte-check 1631 files, 0 errors/0
      warnings; `tsc -p tsconfig.node.json` clean (claude-sonnet,
      2026-09-01T19:46:00Z)
- [x] guard — `npm run guard`: all seven sub-guards green (biome — clean
      after `biome format --write` on the new test's multi-line query;
      boundaries; clean-code — nothing new above the 0.5 threshold;
      return-types; throws; i18n — 446 keys x 10 locales unchanged;
      stories — 44/44 covered) (claude-sonnet, 2026-09-01T19:47:00Z)
- [x] build — `npm run build`: vite build clean, no errors (claude-sonnet,
      2026-09-01T19:47:30Z)
- [x] verify — `npm run verify`: 10/10 required checks + both best-effort
      checks (screenshots, axe — 0 blocking violations) passed against the
      real built extension in Chrome for Testing (claude-sonnet,
      2026-09-01T19:46:30Z)
- [x] live-storybook-check — navigated "Many unverified models (large
      gateway catalog)" in a real Chromium (Playwright) at
      http://localhost:6009: typing "gateway-model-7" into the filter
      narrowed "Unverified (24)" to "Unverified (1)" AND auto-expanded it
      (`[expanded]` in the a11y snapshot, no click) with the matching row
      genuinely present; clearing the filter reverted it to collapsed
      "Unverified (24)" with no options listed. Confirmed the accessible
      name fix via the resolved DOM, not eyeballing:
      `document.querySelector('[data-command-group-items][aria-labelledby]')`
      for the Unverified section resolves `aria-labelledby="c1-unverified-heading"`
      to an element whose `textContent` is "Unverified (1)" (and, before
      filtering, "Unverified (24)"/"No tool support (1)" for that section
      and the No-tool-support section respectively, "Self-hosted" for the
      provider group) — every `role="group"` in the popover now has a real,
      non-empty computed accessible name. Also confirmed the badge color fix
      live: the "? Unverified" badge's computed `color` is
      `oklch(0.535 0.016 285.938)`, which is exactly `--muted-foreground`
      (verified against `getComputedStyle(document.documentElement)`), not
      `--foreground`'s `oklch(0.141 0.005 285.823)`. Killed the Storybook
      process afterward (claude-sonnet, 2026-09-01T19:48:00Z)

## Comments

- **claude** (2026-09-01T00:00:00.000Z): Filed from a live bug report — the
  picker at src/sidepanel/components/ModelPicker.svelte:429/447 traps scroll
  via the flexbox auto-min-height rule. Amended decisions/22 with the root
  cause and fix. Dispatching a Sonnet subagent to implement per this card;
  I'll oversee and verify gates before moving this to review.
- **claude-sonnet** (2026-09-01T19:00:00Z): Read decisions/22's amendment and
  ModelPicker.svelte end to end before touching anything, per the card. Fixed
  the scroll trap: added `min-h-0` to `Command.Root`
  (src/sidepanel/components/ModelPicker.svelte:490-494) and `min-h-0 flex-1`
  to `Command.List` (src/sidepanel/components/ModelPicker.svelte:512). Row
  density pass in the shared `modelRow` snippet
  (src/sidepanel/components/ModelPicker.svelte:369-415): `py-2`→`py-1.5`,
  tightened the text-stack gap to `gap-0`, added `leading-tight` to the
  name/provider/reason lines. Swapped the raw `<span>` capability badge for
  the shadcn `Badge` (`variant="outline"`, tool-capable rows keep
  `border-primary/30 text-primary`), following AnnotationBadges.svelte's
  usage pattern (src/sidepanel/components/AnnotationBadges.svelte:42-55);
  added the import at src/sidepanel/components/ModelPicker.svelte:66. Verified
  via `grep -rl 'ui/command"' src --include="*.svelte"` that ModelPicker is
  the only consumer before editing command-group.svelte directly.
- **claude-sonnet** (2026-09-01T19:10:00Z): Added the sticky-heading local
  edit to src/ui/components/ui/command/command-group.svelte:42-49 (`sticky
  top-0 z-10 bg-popover`, padding `py-1.5`→`py-1`), commented "Local edit
  (card 130)" matching badge.svelte's convention. Added the `sectionDisplay`
  temporary prop (src/sidepanel/components/ModelPicker.svelte:111-133),
  wired the two collapsible branches for the Unverified/No-tool-support
  `Command.Group`s (src/sidepanel/components/ModelPicker.svelte:592-654)
  behind a `collapsibleHeading` snippet
  (src/sidepanel/components/ModelPicker.svelte:417-440) — a real `<button
  aria-expanded>` since `Command.Group`'s own `heading` prop only renders
  static text. Composed "Unverified (N)"/"No tool support (N)" from the
  existing i18n strings plus the row count client-side, so no new message
  key was needed (skips the i18n-key checklist item). Added
  `seedLargeUnverifiedCatalog` (1 tool-capable + 24 unverified + 1 no-tools,
  simulating a big gateway catalog) and the two comparison `<Story>` exports
  to src/sidepanel/components/ModelPicker.stories.svelte. Added the
  never-hidden regression test (24-row Unverified bucket, asserts every row
  renders + option count) to
  src/sidepanel/components/ModelPicker.test.ts. `npm test`/`npm run
  check`/`npm run guard` all green at this point.
- **claude-sonnet** (2026-09-01T18:41:00Z): `npm run verify` initially failed
  on a corrupted/incomplete Chrome for Testing download in
  `.chrome-for-testing/chrome/152.0.7977.64-chrome-mac-arm64.zip` —
  environment issue, unrelated to this card's diff. Removed the partial
  install and reinstalled with `npx @puppeteer/browsers install
  chrome@152.0.7977.64 --path .chrome-for-testing`; verify then ran clean,
  10/10 required checks.
- **claude-sonnet** (2026-09-01T18:50:00Z): Live-checked both new Storybook
  stories in a real Chromium via Playwright (claude-in-chrome wasn't
  connected in this environment). Found the `min-h-0` fix from decisions/22's
  amendment ALONE did not actually scroll: `Command.List.scrollHeight`
  stayed equal to `clientHeight` even with 26 rows visibly overflowing it.
  Root-caused live (see this session's tool transcript) to the SAME flexbox
  "automatic minimum size" bug recurring one level deeper — each
  `Command.Group` is a flex item of `Command.List`'s `flex flex-col`
  container and, without `shrink-0`, was collapsing below its own rows'
  content height; separately, `Command.Group`'s own `overflow-hidden`
  (command-group.svelte's base class) made IT the nearest CSS-sticky scroll
  container instead of `Command.List`, pinning the sticky heading to the
  Group's own static box instead of the real scrolled viewport. Fixed with
  `shrink-0 overflow-visible` added to command-group.svelte's root class
  (src/ui/components/ui/command/command-group.svelte:17-37), documented
  inline and in decisions/22's amendment (`### Consequences (addendum)`).
  Confirmed live afterward: `scrollHeight` 1650 vs `clientHeight` 346,
  `scrollTop` genuinely moves, reached the bottom row; sticky heading stays
  pinned while scrolling its section (one very minor, pre-existing cosmetic
  nit: a ~4px sliver of the previous row's text peeks through
  `Command.List`'s own `py-1` top padding during the sticky transition —
  functional, not blocking, flagging rather than gold-plating further). Also
  confirmed both collapsible-section toggles expand/collapse independently
  with correct counts. Re-ran `npm test`/`npm run check`/`npm run
  guard`/`npm run build`/`npm run verify` after this second command-group.svelte
  edit — all green (see Gates above).
- **claude-sonnet** (2026-09-01T19:57:00Z): Out-of-scope note, not touched:
  ModelPicker.test.ts's `content()` helper
  (src/sidepanel/components/ModelPicker.test.ts:156-166) can throw "Found
  multiple elements" if a test leaves `state.resolution` at the default
  `{status:"none"}` while providers are populated — `providerPicker_chooseModelLabel`
  and `providerPicker_choosePopoverAriaLabel` are both literally "Choose a
  model" (messages/en.json:294,296), so the trigger chip and the popover
  region collide on that text. Hit this writing the new regression test and
  worked around it by not using `content()` there; flagging rather than
  fixing since it's a pre-existing i18n string collision, not part of this
  card's scope.
- **claude-sonnet** (2026-09-01T19:58:00Z): All of my gates are green (see
  `## Gates`). Leaving `column: doing` rather than `review` — the two
  checklist items still open ("Jonathan picks a variant" and the
  conditional-on-that-pick i18n/decision-record work) are explicitly his to
  do, and per the task brief I'm stopping here without committing/pushing
  for diff review first.
- **claude-sonnet** (2026-09-01T20:35:00Z): Jonathan picked collapsible
  sections, recorded as decisions/43-collapsible-picker-sections.md. Made
  it the only behavior: deleted the temporary `sectionDisplay` prop and its
  `Props` interface (replaced by a plain comment at
  src/sidepanel/components/ModelPicker.svelte:111-117), and the
  always-expanded branches for both the Unverified and No-tool-support
  `Command.Group`s, leaving the single collapsible-only block at
  src/sidepanel/components/ModelPicker.svelte:576-611. Updated the
  `collapsibleHeading` snippet's doc comment at :402-410 to point at
  decisions/43 instead of describing a Storybook comparison aid. In
  src/sidepanel/components/ModelPicker.stories.svelte: dropped the "always
  expanded" `<Story>` and its `args={{ sectionDisplay: ... }}`, kept
  `seedLargeUnverifiedCatalog` (:123-151) with its doc comment updated to
  reference decisions/43, and renamed the surviving story (:169-172) to
  "Many unverified models (large gateway catalog)" — no more comparison
  framing since this is the shipped behavior now.
  In src/sidepanel/components/ModelPicker.test.ts: since rows in the
  Unverified/No-tool-support sections no longer render until their
  disclosure heading is clicked (`{#if unverifiedExpanded}`/`{#if
  noToolsExpanded}` in ModelPicker.svelte), updated every test that
  previously asserted a row was visible right after render to click
  `screen.findByRole("button", { name: "<Heading> (<count>)" })` first —
  the unknown-capability badge test (:236-253), the no-tools badge test
  (:298-315), and the disabled-row/no-selectModel-on-click test (:319-341).
  Updated the card-130 never-hidden regression test (:267-296) to expand
  the section before asserting all 24 rows render — per decisions/43,
  "reachable after one click" satisfies decisions/06/11's never-hide rule,
  not "immediately on render"; also asserts the heading count. Added a new,
  dedicated small test (:216-234) proving the core new behavior directly: a
  section starts collapsed (heading shows "(1)", row absent,
  `aria-expanded="false"`) and a click reveals it
  (`aria-expanded="true"`, row present). The filter-threshold tests
  (:409-437) only ever seed tool-capable (selectable, always-expanded) rows,
  so they needed no changes. One jsdom-only wrinkle in the regression test
  (:267-296): expanding 24 rows post-mount triggers a floating-ui
  reposition that jsdom's missing `ResizeObserver`/layout leaves the
  popover's positioning wrapper stuck at inline `visibility: hidden`
  (confirmed via a throwaway debug script that the 24 real `role="option"`
  elements are genuinely in the DOM) — used
  `screen.getAllByRole("option", { hidden: true })` there, documented
  inline, rather than mask it silently; unrelated to the real DOM/a11y tree
  in a live browser (see the live-storybook-check gate).
  Gates: `npm test` (81 files, 1326 tests), `npm run check` (0
  errors/warnings), `npm run guard` (all seven, i18n unchanged at 446 keys
  x 10 locales — confirms decisions/43's "no new key needed" claim), `npm
  run build`, and `npm run verify` (10/10 + both best-effort) all green —
  see `## Gates` for full evidence lines. Live-checked the renamed
  Storybook story via Playwright against `npm run storybook -- -p 6008
  --ci --no-open`: both sections render collapsed with correct counts
  ("Unverified (24)", "No tool support (1)"), and clicking each
  independently expands it (`aria-expanded` flips to `true`, option count
  goes 1 → 25 → 26 across both clicks). Killed the Storybook process
  afterward. decisions/43 already matched what I built exactly — no
  amendment needed. Moving to `column: review`.
- **claude-sonnet** (2026-09-01T20:55:00Z): Three code-review fixes on the
  review-column diff, all in `column: review` per the task brief (not
  restarting the card).
  **Fix 1 (filtering didn't reveal matches inside collapsed sections):**
  `unverifiedRows`/`noToolsRows` (src/sidepanel/components/ModelPicker.svelte:354-364)
  were already filtered by the query, so a match correctly narrowed a
  collapsed heading's count but stayed hidden behind the raw
  `unverifiedExpanded`/`noToolsExpanded` toggle. Added
  `filtering`/`unverifiedEffectivelyExpanded`/`noToolsEffectivelyExpanded`
  derived values (ModelPicker.svelte:384-390): `(manual toggle) ||
  (filtering && rowCount > 0)`, deliberately NOT an `$effect` mutating the
  raw toggles (which would fight a manual collapse-during-filter click on
  every re-run) — the raw `unverifiedExpanded`/`noToolsExpanded` state is
  never written to by the filter, so it stays a stable, independent target
  for the toggle's own click handler, and the auto-expand naturally reverts
  the moment the query clears since only the OR's second term goes false.
  Wired the two `{#if}` row-gates and the `expanded` argument passed to
  `collapsibleHeading` to the new "effectively expanded" values instead of
  the raw toggles (ModelPicker.svelte:637-673). Added a dedicated test,
  `ModelPicker.test.ts:242-283`, proving a filtered match in a
  currently-collapsed 9-row Unverified section becomes visible with no
  extra click, and reverts to collapsed once the filter is cleared.
  **Fix 2 (capability badge lost its muted-foreground default):** the
  `Badge` at ModelPicker.svelte:439-448 only added `text-primary` for the
  tool-capable case, so `Badge`'s own `text-foreground` won for
  Unverified/No-tool-support rows instead of the original span's muted
  default. Added `text-muted-foreground` as the always-on base class
  (ModelPicker.svelte:441-444), matching the pattern at
  CallLogEntry.svelte:145, ToolCallRow.svelte:218, AnnotationBadges.svelte:52.
  **Fix 3 (collapsible sections lost their accessible group name):**
  bits-ui only wires `Command.GroupItems`' (the actual `role="group"`
  element per bits-ui's `command.svelte.js` — `Command.Group` itself is
  `role="presentation"`) `aria-labelledby` when a heading is rendered
  through the `heading` string prop, which fires `CommandGroupHeadingState`'s
  `attachRef` onto `group.headingNode`. The interactive
  `collapsibleHeading` button (ModelPicker.svelte:462-479 now takes a
  `headingId` argument and sets `id={headingId}` on the button, :465-470)
  never triggers that wiring since it renders as a `children` sibling, not
  through `heading`. Added a `headingId` prop to
  src/ui/components/ui/command/command-group.svelte:5-31, forwarded to
  `<CommandPrimitive.GroupItems aria-labelledby={headingId}>`
  (command-group.svelte:71) — `mergeProps`' plain-key rule
  (svelte-toolbelt: `b !== undefined ? b : a`) means bits-ui's own computed
  `aria-labelledby` still wins whenever a real `heading` prop is also
  passed, so this doesn't disturb the provider-group case. Added
  `unverifiedHeadingId`/`noToolsHeadingId` (`$props.id()`-derived, unique
  per mounted instance) at ModelPicker.svelte:135-137, and wired
  `headingId={unverifiedHeadingId}`/`headingId={noToolsHeadingId}` onto the
  two `Command.Group`s (ModelPicker.svelte:637, 653). Verified live (see
  the new `live-storybook-check` gate entry) via the resolved DOM rather
  than just adding the attribute and hoping: `aria-labelledby` on each
  section's `[data-command-group-items]` resolves to an element with a
  real, non-empty `textContent` ("Unverified (24)", "No tool support (1)",
  and "Self-hosted" for the untouched provider-group case).
  Gates: `npm test` (81 files, 1327 tests), `npm run check` (0
  errors/warnings), `npm run guard` (all seven, including a `biome format
  --write` pass on the new test's formatting; i18n unchanged at 446 keys x
  10 locales), `npm run build`, and `npm run verify` (10/10 required +
  both best-effort) all green — see `## Gates` for full evidence lines.
  Live-checked all three fixes against the "Many unverified models (large
  gateway catalog)" Storybook story via Playwright at
  http://localhost:6009 (details in the gate entry above); killed
  Storybook afterward. Leaving `column: review` as instructed — these were
  review-column fixes, not a restart of the card.
- **claude** (2026-09-01T21:05:00.000Z): Committed to branch `card/130`,
  pushed to origin, and opened GitLab issue #1 and MR !1 for tracking,
  requesting review from shockwave.
  Issue: https://gitlab.beluga-sirius.ts.net/flying-dice/open-chat-webmcp/-/work_items/1
  MR: https://gitlab.beluga-sirius.ts.net/flying-dice/open-chat-webmcp/-/merge_requests/1
