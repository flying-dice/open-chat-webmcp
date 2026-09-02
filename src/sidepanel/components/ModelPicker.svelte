<script lang="ts">
  // Card 113 renamed this file from ProviderPicker.svelte: card 51 /
  // decisions/22 flattened it into a single MODEL picker grouped by provider,
  // and the old name had been describing card 23's two-level control ever
  // since — while the heading read "Choose your model" and
  // `selectModel`/`ModelListEntry` were the vocabulary throughout.
  /**
   * The composer's flat model picker (card 51, decisions/22-flat-model-picker.md
   * — refining card 23's two-level provider-then-model control; re-skinned
   * onto shadcn's Popover + Command by decisions/28). A compact chip in the
   * composer's action row opens a sheet ABOVE it, showing every configured
   * provider's models as ONE list:
   *
   *   1. Selectable models, grouped under a heading per provider. A provider
   *      contributes a heading either because it has selectable models, or
   *      because it's in a state worth surfacing on its own — loading, a
   *      connection error, "no model-listing API" (with the manual-entry
   *      fallback), or "no models installed yet". Decisions/22's
   *      consequences: losing the old provider `<select>` removed the only
   *      place a provider's connection error was stated prominently, so
   *      that error has to live on the group heading now, or it disappears.
   *   2. "Unverified" — `unknown` capability (decisions/11), selectable.
   *   3. "No tool support" — `no-tools`, disabled. Never hidden (decisions/06).
   *   Rows in groups 2/3 carry their provider as secondary text, since
   *   they're no longer under a provider heading.
   *
   * All the actual state — providers, the active tab's persisted selection,
   * and EVERY provider's model list (loaded in parallel, degrading per
   * provider) — lives in src/sidepanel/stores/selection.svelte.ts; this
   * component is presentation plus the popover's open/close, filtering, and
   * keyboard handling.
   *
   * Popover.Root's open/close state is driven one-way from the store
   * (`selection.pickerOpen`, toggled by its own trigger click, or opened
   * directly by Composer.svelte's blocked-state button) via `onOpenChange`,
   * so there's still exactly one source of truth for whether the sheet is
   * open. Command.Root (`shouldFilter={false}`) supplies keyboard roving
   * (arrow keys skip disabled rows automatically, Enter activates the
   * currently-highlighted row, and reselecting the first valid row when a
   * filter removes the highlighted one) and Escape-to-close bubbles to the
   * Popover unhandled by Command — this replaces the previous hand-rolled
   * pointerdown/keydown listeners and roving-focus helpers entirely. Row
   * VISIBILITY (which groups/rows exist at all) stays our own derived logic
   * below, exactly as before — `shouldFilter={false}` tells Command not to
   * apply its own fuzzy filter/sort on top of it.
   */
  import { tick } from "svelte";
  import {
    selection,
    syncToTab,
    selectModel,
    enterManualModel,
    reloadModels,
    refresh,
    openOptionsPage,
    closePicker,
    openPicker,
    type ModelListEntry,
    type ModelsState,
  } from "../stores/selection.svelte";
  import { panel } from "../stores/panel.svelte";
  import Markdown from "../../ui/components/Markdown.svelte";
  import Icon from "./Icon.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Separator } from "$lib/components/ui/separator";
  import { cn } from "$lib/utils";
  import { isolateLtr } from "../../ui/bidi";
  import {
    isSelectable,
    isSelectionUsable,
    type ModelCapabilities,
    type ProviderModel,
  } from "../../domain/providers";
  import { capabilityBadge } from "../presentation/capabilityBadge";
  // Card 102 (decisions/37-i18n-paraglide.md): the LOCALIZED wrapper — see
  // src/ui/capabilityMessage.ts's own doc comment for why this lives
  // UI-side rather than the domain export of the same-shaped function.
  import { capabilityReason } from "../../ui/capabilityMessage";
  import type { ProviderConfig } from "../../domain/providers";
  import { m } from "../../paraglide/messages.js";
  import { uiTextDirection } from "../../ui/direction";

  /**
   * Wrap a copy-pasteable command as a fenced code block so it renders
   * through Markdown.svelte's existing code-block pipeline (src/ui/markdown.ts's
   * `renderCodeBlock`) — that pipeline already gives every fenced block its
   * own working "Copy"/"Copied" button, so this reuses that exact,
   * already-tested affordance instead of hand-rolling a second one
   * (card 14: "make the fix copyable, not just described").
   */
  function fenceOf(command: string): string {
    return `\`\`\`\n${command}\n\`\`\``;
  }

  // Card 35/36: the popover's open/close state lives in the store
  // (`selection.pickerOpen`), not as local state here, so
  // Composer.svelte's blocked-composer empty state can open THIS mounted
  // instance in one click rather than owning a second, independent popover.
  let manualModelInputs = $state<Record<string, string>>({});
  let filterQuery = $state("");
  // Both bound via `bind:ref` to shadcn components whose `ref` prop is
  // `$bindable(null)` — starting these at bare `$state()` (i.e. `undefined`)
  // throws Svelte's props_invalid_value at mount, so they start `null`.
  let filterInputEl: HTMLInputElement | null = $state(null);
  let commandRootEl: HTMLDivElement | null = $state(null);
  // Review fix on card 130 (MR !1, note 12491): needed so
  // `restoreDisclosureHighlight` can read/repair this element's OWN
  // `scrollTop`, not just focus and highlight. See that function's doc
  // comment for why a third thing needed restoring.
  let commandListEl: HTMLDivElement | null = $state(null);

  // Card 130 / decisions/43: the Unverified and No-tool-support sections
  // start collapsed behind a heading stating their count, and expand in
  // place on click. Both start collapsed — reset alongside the filter query
  // whenever the popover closes (see the `$effect` below) so each open
  // starts from the same condensed state rather than remembering the last
  // session's expansion.
  let unverifiedExpanded = $state(false);
  let noToolsExpanded = $state(false);

  /**
   * Review fix on card 130 (MR !1, note 12384): while filtering auto-expands
   * a section (see `*EffectivelyExpanded` below), a click on the heading has
   * to produce a REAL, visible toggle — not a no-op — and must NOT leak into
   * the raw `unverifiedExpanded`/`noToolsExpanded` state once the filter
   * clears (that leak is what "latched the section open" after clearing the
   * query). So filtering gets its OWN override, entirely separate from the
   * raw toggle: `null` means "no override yet, use the auto-expand default
   * (open)"; `true`/`false` are an explicit click during filtering. Reset to
   * `null` whenever `filtering` (below) goes false, so it never survives
   * into the next filter session or leaks into the non-filtering toggle.
   */
  let unverifiedFilterOverride: boolean | null = $state(null);
  let noToolsFilterOverride: boolean | null = $state(null);

  /**
   * Review fix on card 130 (MR !1, note 12451): the Unverified/No-tool-
   * support disclosure headings render as a real `Command.Item` (a genuine
   * `role="option"` row) rather than a `<button>`/custom widget nested
   * inside the group — see the doc comment on `collapsibleOption` below for
   * why. That row's own visible text ("Unverified (24)") is exactly what a
   * plain string `heading` prop would ALSO render (command-group.svelte's
   * `GroupHeading`), so passing `heading` the ordinary way would print the
   * label twice on screen. The two groups below instead pass `heading` with
   * `headingHidden` — command-group.svelte renders that `GroupHeading` with
   * `sr-only` instead of its normal visible classes, so the group still gets
   * a real, non-empty `aria-labelledby` (measured: matches origin/main's
   * three-of-three named groups) without a second, visible copy of the
   * label. This was previously skipped as a false economy ("no `heading`
   * string prop here" — see the group templates below) on the theory that
   * the option row's own content-based accessible name would cover the
   * *group's* name too; it doesn't — `group` and `option` are named
   * independently, and skipping `heading` left `aria-labelledby: null` on
   * both groups (note 12451's measured regression from origin/main).
   */

  /** A current tool-calling-capable Ollama model, named concretely per card 14 rather than leaving "pull a model" vague. */
  const OLLAMA_TOOL_MODEL_SUGGESTION = "llama3.1";

  // Keep the store pointed at whichever tab is active. panel.pageInfo is
  // owned by src/infra/chrome-runtime/tab-sync.ts; this only reads it.
  $effect(() => {
    const info = panel.pageInfo;
    if (info) void syncToTab(info.tabId, info.origin);
  });

  // Reset the filter and the section collapse state between opens.
  $effect(() => {
    if (!selection.pickerOpen) {
      filterQuery = "";
      unverifiedExpanded = false;
      noToolsExpanded = false;
      unverifiedFilterOverride = null;
      noToolsFilterOverride = null;
    }
  });

  /**
   * Land keyboard focus somewhere useful the moment the sheet appears — the
   * filter box when there is one (decisions/22: "filter" is one of the
   * keyboard affordances this picker has to keep), otherwise the Command
   * root itself, so arrow keys work immediately without a click first.
   *
   * Popover.Content's own default open-focus (bits-ui's FocusScope) would
   * otherwise land on the FIRST genuinely tabbable descendant — which,
   * since Command's rows are `role="option"` with no tabindex of their own,
   * is the footer's "Refresh" button, not the list. `preventDefault` here
   * (bits-ui's `onOpenAutoFocus` is cancelable, mirroring Radix) opts out
   * of that default so this can place focus intentionally instead.
   */
  function handleOpenAutoFocus(e: Event): void {
    e.preventDefault();
    void tick().then(() => {
      if (filterInputEl) filterInputEl.focus();
      else commandRootEl?.focus();
    });
  }

  function handleManualSubmit(providerId: string, e: SubmitEvent): void {
    e.preventDefault();
    void enterManualModel(providerId, manualModelInputs[providerId] ?? "");
  }

  // ---- Trigger chip label/variant -----------------------------------

  const triggerInfo = $derived.by(
    (): { label: string; variant: "normal" | "muted" | "warning" } => {
      if (selection.providersStatus === "loading")
        return { label: m.loadingProvidersLabel(), variant: "muted" };
      if (selection.providers.length === 0)
        return { label: m.providerPicker_noProviderLabel(), variant: "warning" };
      const r = selection.resolution;
      if (r.status === "dangling")
        return { label: m.providerPicker_providerRemovedLabel(), variant: "warning" };
      if (r.status === "none")
        return { label: m.providerPicker_chooseModelLabel(), variant: "muted" };
      // Card 35: still needs a one-click confirmation before it can send —
      // flag that on the trigger chip too, not just in the composer.
      if (selection.needsConfirmation) {
        return {
          label: m.providerPicker_confirmLabel({
            label: `${r.config.name} · ${isolateLtr(r.model)}`,
          }),
          variant: "warning",
        };
      }
      return { label: `${r.config.name} · ${r.model}`, variant: "normal" };
    },
  );

  /**
   * What the chip actually prints. Decisions/22: the chip shows the MODEL
   * ID ALONE, truncated — not "provider / model". The provider lives in the
   * list now; the chip is a status, and the model id is what the user
   * thinks in. `triggerInfo.label` (the fuller "provider · model" or
   * warning sentence) stays as the accessible name and tooltip, where the
   * disambiguating provider name is still available on hover.
   */
  const triggerText = $derived.by((): string => {
    const r = selection.resolution;
    if (isSelectionUsable(r, selection.needsConfirmation)) return r.model;
    return triggerInfo.label;
  });

  /**
   * `triggerText` is the bare model id in the common case (an identifier,
   * always LTR) but falls back to a full translated sentence in the loading/
   * error/confirm states — forcing `dir="ltr"` unconditionally on the chip
   * would misrender THOSE as left-to-right too, so the attribute tracks
   * which case is live (card 104's RTL bidi-isolation pass).
   */
  const triggerTextIsModelId = $derived(
    isSelectionUsable(selection.resolution, selection.needsConfirmation),
  );

  // ---- Building the flat, grouped list --------------------------------

  interface Row {
    providerId: string;
    providerName: string;
    isOllama: boolean;
    model: ProviderModel;
    capability: ModelCapabilities | undefined;
    isActive: boolean;
  }

  function toRow(provider: ProviderConfig, entry: ModelListEntry): Row {
    return {
      providerId: provider.id,
      providerName: provider.name,
      isOllama: provider.type === "ollama",
      model: entry.model,
      capability: entry.capability,
      isActive:
        selection.resolution.status === "ok" &&
        selection.resolution.config.id === provider.id &&
        selection.resolution.model === entry.model.id,
    };
  }

  /**
   * Which of decisions/22's three buckets a row belongs in. `undefined`
   * capability (see ModelListEntry's doc comment — never actually observed
   * in practice, since a provider only ever reaches `"loaded"` once every
   * entry's capability has resolved) falls back to "unverified" rather than
   * "selectable" or vanishing — decisions/06's "never hide, never guess
   * safe" rule applies here too.
   */
  // TODO: clean-code - 0.35 - SRP: mixes popover open/close + keyboard/filter UI with row-bucketing/grouping business logic (toRow, bucketOf, groups, visibleGroups, unverifiedRows, noToolsRows) in one file. STAYS: the bucketing is not business logic in the domain sense — the RULE it applies (`isSelectable`, decisions/06/11) already lives in src/domain/providers/capability.ts and is imported. What is left here is presentation policy: which of three buckets a row is SHOWN in and in what order, which is this picker's own layout decision and has no second consumer. Card 113 checked for one: the options page's default-model dropdown needs a filtered list, not buckets.
  function bucketOf(
    capability: ModelCapabilities | undefined,
  ): "selectable" | "unverified" | "no-tools" {
    if (isSelectable(capability)) return "selectable";
    if (capability?.status === "no-tools") return "no-tools";
    return "unverified";
  }

  interface ProviderGroup {
    provider: ProviderConfig;
    state: ModelsState | undefined;
    allRows: Row[];
    selectableRows: Row[];
  }

  const groups = $derived.by((): ProviderGroup[] =>
    selection.providers.map((provider) => {
      const state = selection.modelsByProvider[provider.id];
      const allRows: Row[] =
        state?.status === "loaded"
          ? state.entries.map((e) => toRow(provider, e))
          : state?.status === "not-supported" && state.manualEntry
            ? [toRow(provider, state.manualEntry)]
            : [];
      return {
        provider,
        state,
        allRows,
        selectableRows: allRows.filter((r) => bucketOf(r.capability) === "selectable"),
      };
    }),
  );

  /** A filter box over a handful of models is noise (decisions/22) — it only earns its place once there's enough to actually search through. */
  const FILTER_THRESHOLD = 8;
  const totalRowCount = $derived(groups.reduce((sum, g) => sum + g.allRows.length, 0));
  const showFilter = $derived(totalRowCount > FILTER_THRESHOLD);

  function normalizedQuery(): string {
    return showFilter ? filterQuery.trim().toLowerCase() : "";
  }

  /** Decisions/22: "Filtering matches model id and provider name." */
  function matchesQuery(providerName: string, modelId: string): boolean {
    const q = normalizedQuery();
    if (!q) return true;
    return modelId.toLowerCase().includes(q) || providerName.toLowerCase().includes(q);
  }

  function providerNameMatches(name: string): boolean {
    const q = normalizedQuery();
    return !q || name.toLowerCase().includes(q);
  }

  /**
   * Section 1: one entry per provider that's worth a heading. A provider
   * earns one either because it has selectable models matching the current
   * filter, or — regardless of the filter, as long as the provider's own
   * name isn't being filtered out — because it's in a state that would
   * otherwise vanish with no explanation: still loading, a connection
   * error, "no model-listing API" (manual entry lives here), or "loaded,
   * but nothing installed yet". A provider that loaded fine but simply has
   * no TOOL-CAPABLE models (decisions/22's literal "no selectable models
   * contributes no heading") is the one case that's intentionally skipped —
   * its models still show, disabled, under Unverified/No tool support
   * below, each carrying this provider's name.
   */
  const visibleGroups = $derived(
    groups
      .map((g) => ({
        ...g,
        filteredSelectable: g.selectableRows.filter((r) =>
          matchesQuery(g.provider.name, r.model.id),
        ),
      }))
      .filter((g) => {
        if (g.filteredSelectable.length > 0) return true;
        const q = normalizedQuery();
        if (q && !providerNameMatches(g.provider.name)) return false;
        return g.state?.status !== "loaded" || g.state.entries.length === 0;
      }),
  );

  const unverifiedRows = $derived(
    groups
      .flatMap((g) => g.allRows.filter((r) => bucketOf(r.capability) === "unverified"))
      .filter((r) => matchesQuery(r.providerName, r.model.id)),
  );
  const noToolsRows = $derived(
    groups
      .flatMap((g) => g.allRows.filter((r) => bucketOf(r.capability) === "no-tools"))
      .filter((r) => matchesQuery(r.providerName, r.model.id)),
  );
  /** Keeps the concrete `ollama pull` suggestion alive for the "some models installed, none tool-capable" case, without violating the "no heading for a provider with no selectable models" rule above — this hint lives on the No-tool-support SECTION instead of on a per-provider heading. */
  const noToolsHasOllama = $derived(noToolsRows.some((r) => r.isOllama));

  /**
   * Review fix on card 130 (MR !1, notes 12384/12387 — the original OR'd
   * design is preserved only in git history): `unverifiedRows`/
   * `noToolsRows` above are already filtered by the query, so typing e.g.
   * "gateway-model-7" correctly narrows a collapsed heading down to
   * "Unverified (1)" and that match should be visible without an extra
   * click. The first cut expressed that as
   * `unverifiedExpanded || (filtering && rows.length > 0)` — but the OR
   * pinned the rendered state to `true` while filtering regardless of
   * `unverifiedExpanded`, so a click during filtering flipped the raw
   * toggle with zero visible effect, AND left it `true`, which then stuck
   * the section open once the query was cleared.
   *
   * Fixed by giving filtering its OWN override (`unverifiedFilterOverride`/
   * `noToolsFilterOverride` above) instead of overloading the raw toggle:
   * while filtering leaves this section nonempty, the effective state is
   * the override if the user has clicked during THIS filter session
   * (`?? true` — auto-expanded by default), otherwise the raw toggle
   * exactly as it is outside filtering. The override is reset to `null`
   * whenever `filtering` goes false (the `$effect` below), so a click made
   * while filtering can never leak into the next session or into the
   * non-filtering toggle — a filtered-open section reverts to whatever
   * `unverifiedExpanded` already was (collapsed, unless the user had
   * manually expanded it before filtering started) the moment the query is
   * cleared.
   */
  /**
   * Review fix on card 130 (MR !1, note 12491's re-review): the reviewer
   * flagged that this auto-expand path does NOT run through
   * `toggleUnverifiedDisclosure`/`toggleNoToolsDisclosure`, so it gets none
   * of `restoreDisclosureHighlight`'s scroll-position handling, and asked for
   * a DELIBERATE decision here rather than silently inheriting whatever
   * happens.
   *
   * Decision: no special-casing added. Every keystroke that changes the
   * query re-runs bits-ui's own `search`-change handling (`#filterItems()`
   * -> `#sort()` -> `#selectFirstItem()`), which highlights and
   * `scrollIntoView`s the first matching row on every keystroke regardless
   * of anything this component does — that is Command's ordinary,
   * long-standing filtering behavior, not something card 130 introduced.
   * Landing on the top of the new result set while typing is the
   * expected combobox convention (every keystroke can change what "first
   * match" even means), and the user's attention and real DOM focus are
   * both already on the input they're actively typing into — unlike toggle
   * activation, there is no specific row the user just asked to see that a
   * scroll-preserving mechanism would need to protect. Measured live in
   * Chromium (Storybook's "Many unverified models" story, narrowing then
   * widening a query while scrolled): `data-selected` and
   * `document.activeElement` stayed correct together on every keystroke:
   * the newly-matched top row highlighted and the filter input kept focus —
   * see board card 130's journal for the full trace across all four
   * activation paths, including this one.
   */
  const filtering = $derived(normalizedQuery() !== "");
  const unverifiedEffectivelyExpanded = $derived(
    filtering && unverifiedRows.length > 0
      ? (unverifiedFilterOverride ?? true)
      : unverifiedExpanded,
  );
  const noToolsEffectivelyExpanded = $derived(
    filtering && noToolsRows.length > 0 ? (noToolsFilterOverride ?? true) : noToolsExpanded,
  );

  // The override only means anything WHILE filtering — reset it the moment
  // filtering ends (query cleared, or narrowed back below FILTER_THRESHOLD)
  // so it never survives into the next filter session. Popover-close already
  // resets it directly above too (belt and suspenders: that effect fires on
  // close regardless of how `filtering` gets there).
  $effect(() => {
    if (!filtering) {
      unverifiedFilterOverride = null;
      noToolsFilterOverride = null;
    }
  });

  /** Toggle callbacks passed into `collapsibleOption` — during filtering they flip the filter-scoped override; otherwise the raw persistent toggle, exactly as outside filtering. */
  function toggleUnverified(): void {
    if (filtering && unverifiedRows.length > 0) {
      unverifiedFilterOverride = !(unverifiedFilterOverride ?? true);
    } else {
      unverifiedExpanded = !unverifiedExpanded;
    }
  }
  function toggleNoTools(): void {
    if (filtering && noToolsRows.length > 0) {
      noToolsFilterOverride = !(noToolsFilterOverride ?? true);
    } else {
      noToolsExpanded = !noToolsExpanded;
    }
  }

  /**
   * Review fix on card 130 (MR !1, note 12449): bound to `Command.Root`'s
   * `value` below. bits-ui derives EVERY item's `data-selected`/`aria-
   * selected` (`CommandItemState.isSelected`, command.svelte.js) straight
   * off this value, so forcing it onto a toggle's own `value` forces that
   * toggle to read as highlighted, immediately and reactively — this is the
   * "controllable highlighted value" the finding asked to look for.
   *
   * Why it needs forcing at all: with `shouldFilter={false}` (this list's
   * own visibility logic replaces Command's), `CommandRootState#sort()`
   * unconditionally re-picks the FIRST valid item (`#selectFirstItem()`)
   * every time `registerItem` runs for a newly-mounted item, once past
   * initial mount. Expanding a section mounts a batch of newly-visible rows,
   * each a fresh `registerItem` call, so activating the toggle is
   * immediately followed — a few ticks later, via bits-ui's own
   * `afterTick`-chained `registerItem` -> `#sort()` -> `#selectFirstItem()`
   * — by the highlight silently jumping to whatever row now sorts first.
   * Nothing on screen shows this: the toggle keeps its `data-value`, it
   * simply stops being `[data-selected]`. The next Enter/click therefore
   * lands on that first row instead of re-collapsing the section — note
   * 12449's exact repro.
   *
   * There is no prop to opt out of that reselect (read: command.svelte.js
   * has no "don't reselect on registration" option), so this reacts instead
   * of preventing: `tick()` a handful of times after every toggle — enough
   * to span `registerItem`'s own `afterTick` plus `#selectFirstItem`'s
   * nested one — snapping `highlightedValue` back onto the toggle any time
   * bits-ui's async reselect has knocked it off. Collapsing never triggers
   * the reselect in the first place (removing items only reselects if the
   * REMOVED item was the one selected, and the toggle itself is never
   * removed), so these calls are harmless no-ops on that path.
   */
  let highlightedValue = $state("");

  /**
   * Review fix on card 130 (MR !1, note 12491 — the fourth re-review, one
   * new finding after three rounds already fixed highlight then focus):
   * activating a toggle from a scrolled position threw the list's viewport
   * to the top, on top of already being correct on highlight and focus.
   *
   * Root cause, traced in bits-ui's `command.svelte.js`: expanding a section
   * mounts a batch of newly-visible rows, each a fresh `registerItem` call.
   * Every one of those re-runs `CommandRootState#sort()` ->
   * `#selectFirstItem()` (documented above this function, in the
   * `highlightedValue` doc comment — that's what necessitates the
   * highlight-reassert loop below in the first place), and — new finding —
   * `#selectFirstItem()` calls `setValue()` with `preventScroll` false,
   * which internally calls `#scrollSelectedIntoView()`. During the handful
   * of ticks before OUR loop below reasserts the correct `highlightedValue`,
   * bits-ui has already (transiently) selected some OTHER item — typically
   * the very first row of the very first group in the whole list, since
   * `getValidItems()` walks the full list, not just the expanding section —
   * and scrolled THAT into view. By the time we notice and correct
   * `highlightedValue`, the wrong scroll already happened; correcting the
   * highlight after the fact does nothing to undo it. Measured: this is
   * exactly why the prior round's fix (which only reasserted
   * `highlightedValue`) left `data-selected` correct while the viewport
   * still jumped to the top.
   *
   * Fix: capture the list's `scrollTop` before the toggle runs (in the two
   * callers below) and reassert it on every tick of the SAME loop that
   * already reasserts `highlightedValue`, for the same reason — the
   * disturbance can land on any of several ticks, so the correction has to
   * keep re-applying across all of them, not just check once.
   *
   * Restoring the OLD scrollTop verbatim, rather than `scrollIntoView`-ing
   * the toggle or the revealed rows, was picked deliberately over the
   * reviewer's other suggested framing, after live-testing both — with one
   * refinement live-testing surfaced that neither of the reviewer's two
   * framings states outright:
   *   - On EXPAND, nothing ABOVE the current viewport moved (the new rows
   *     land inside/after the section the user already had in view), so the
   *     literally correct scroll position is normally the UNCHANGED one —
   *     there is no better target to compute, and `scrollIntoView` on the
   *     toggle would have been redundant at best (the toggle was already
   *     visible — that is how the user reached it) and wrong at worst: with
   *     both disclosure rows styled `sticky top-0`, `scrollIntoView` treats
   *     a stuck sticky element as already "in view" and may no-op even when
   *     the revealed rows below it are not.
   *   - EXCEPT: when the user was scrolled to the exact bottom already (the
   *     reviewer's own measured repro — `scrollHeight - scrollTop ===
   *     clientHeight`), "unchanged scrollTop" and "the revealed row is
   *     visible" are mutually exclusive, not just two independent asks —
   *     measured live: growing the list's `scrollHeight` while holding
   *     `scrollTop` fixed necessarily pushes the newly-added pixels below
   *     the old bottom edge, off-screen, no matter what that fixed value is.
   *     Something has to give. The one that matches how "already at the
   *     bottom" reads everywhere else (chat logs, tailed output) is to keep
   *     following the bottom as it moves — so `priorWasAtBottom` (captured
   *     alongside `priorScrollTop`, same before-the-toggle timing) makes
   *     this loop target `commandListEl.scrollHeight` instead of the frozen
   *     number on every tick; the browser's own clamping turns that into
   *     "the new max", i.e. the revealed row genuinely on screen, which is
   *     what note 12491 actually asked for. A user who was NOT at the
   *     bottom keeps the literal old value — they were reading something
   *     specific, and content appearing further down than they can already
   *     see is not this picker's business to shove at them.
   *   - On COLLAPSE, content shrinks below the (possibly now out-of-range)
   *     old `scrollTop`; the browser clamps an out-of-range assignment to
   *     the new max automatically, which keeps the collapsed toggle in view
   *     without any special-casing (measured live: collapsing from the
   *     bottom lands at the new, smaller bottom, toggle visible) — and if
   *     `priorWasAtBottom`, the `scrollHeight`-tracking branch above
   *     produces exactly the same clamped destination anyway, so collapse
   *     needs no separate branch at all.
   * Restoring the raw number also sidesteps `scrollIntoView`'s sticky-header
   * special case entirely, and needs no knowledge of which/how many rows a
   * given toggle reveals.
   */
  async function restoreDisclosureHighlight(
    sectionKey: string,
    priorScrollTop: number | null,
    priorWasAtBottom: boolean,
  ): Promise<void> {
    /**
     * Review fix on card 130 (MR !1, note 12478): a CLICK on the toggle
     * doesn't just risk the roving *highlight* handled below — it also moves
     * real DOM *focus*, and nothing was putting that back. `Command.Item`
     * rows carry no `tabindex` of their own (see the module doc comment:
     * real focus stays on the input/root the whole time), so a mousedown on
     * one bubbles focus to the nearest focusable ancestor. Before card 130's
     * `tabindex={0}` fix (line ~763) that ancestor was `Command.Root`; now
     * it's `Command.List` itself. Either way, focus lands on the scroll
     * container instead of the filter input, and every key typed afterward
     * is consumed by the (non-editable) container and silently discarded —
     * the filter box stays visibly empty with no feedback at all.
     *
     * Enter/Space activation never had this problem: focus was already on
     * the input (or root) before the key was pressed, and activating
     * `onSelect` doesn't move it, so this call is a harmless no-op on that
     * path — it fires identically regardless of activation method, matching
     * `handleOpenAutoFocus` (line ~190), which already establishes
     * "filter when there is one, else the root" as this picker's one
     * intended default focus target.
     */
    if (filterInputEl) filterInputEl.focus();
    else commandRootEl?.focus();

    for (let i = 0; i < 8; i++) {
      await tick();
      if (highlightedValue !== sectionKey) highlightedValue = sectionKey;
      if (priorScrollTop !== null && commandListEl) {
        const target = priorWasAtBottom ? commandListEl.scrollHeight : priorScrollTop;
        if (commandListEl.scrollTop !== target) commandListEl.scrollTop = target;
      }
    }
  }

  /**
   * Shared by both toggle callbacks below: capture what
   * `restoreDisclosureHighlight` needs to know about the list's scroll state
   * BEFORE the toggle runs — see that function's doc comment for why both
   * numbers matter.
   *
   * `clientHeight > 0` is a deliberate guard, not just a `scrollHeight -
   * scrollTop <= clientHeight + 1` check on its own: with a genuinely
   * unlaid-out or zero-size container (`clientHeight === 0`), that
   * inequality is trivially true for ANY `scrollTop` (`scrollHeight - x <=
   * 1` whenever `scrollHeight` is also 0), which would misreport "at the
   * bottom" always. jsdom hits this on every test — it has no layout engine,
   * so `scrollHeight`/`clientHeight` never leave 0 — which is exactly how
   * `ModelPicker.test.ts`'s jsdom regression guard caught this: without the
   * guard, that test's `list.scrollTop = 42` got silently corrected back to
   * `0` (jsdom's `scrollHeight`) instead of staying at the literal value it
   * set, since jsdom's zeroed metrics made `wasAtBottom` read `true`
   * unconditionally. Requiring `clientHeight > 0` means "no real box yet" is
   * treated the same as "not at the bottom" — preserve the literal value,
   * the always-safe default — rather than guessing.
   */
  function captureScrollState(): { scrollTop: number | null; wasAtBottom: boolean } {
    if (!commandListEl) return { scrollTop: null, wasAtBottom: false };
    const { scrollTop, scrollHeight, clientHeight } = commandListEl;
    // 1px slop: fractional scroll offsets (seen live, e.g. 1223.5) can leave
    // `scrollHeight - scrollTop` a hair over `clientHeight` at genuine max.
    return {
      scrollTop,
      wasAtBottom: clientHeight > 0 && scrollHeight - scrollTop <= clientHeight + 1,
    };
  }

  function toggleUnverifiedDisclosure(): void {
    const { scrollTop, wasAtBottom } = captureScrollState();
    toggleUnverified();
    void restoreDisclosureHighlight("unverified-toggle", scrollTop, wasAtBottom);
  }

  function toggleNoToolsDisclosure(): void {
    const { scrollTop, wasAtBottom } = captureScrollState();
    toggleNoTools();
    void restoreDisclosureHighlight("no-tools-toggle", scrollTop, wasAtBottom);
  }

  /**
   * Review fix on card 130 (MR !1, note 12450): `handleListKeydown` used to
   * intercept Space centrally on `Command.Root` whenever the toggle held
   * `[data-selected]`, on the theory that this was a rare edge case. Measured
   * by the review, it was not rare: Command auto-highlights the FIRST option
   * on every filter change, and the toggle IS the first option whenever the
   * current query has no tool-capable match — the ordinary shape of
   * searching a large gateway catalog. Any space typed at that point (e.g.
   * mid-way through "local ollama", `ModelPicker.stories.svelte`'s own
   * fixture provider name) was silently eaten and the section collapsed
   * instead, corrupting the query the user was still typing.
   *
   * Now that the toggle is a real `Command.Item` reached through Command's
   * own `onSelect` (see `collapsibleOption` below), Enter and click both
   * activate it correctly with no interception needed — and `role="option"`
   * in a combobox+listbox does not require Space to activate at all; Space's
   * only correct job here is typing into the filter input. So the handler,
   * its `onkeydown` wiring on `Command.Root`, and the Space-specific test
   * coverage it existed for are deleted outright rather than patched.
   */

  function handlePickModel(row: Row): void {
    if (!isSelectable(row.capability)) return;
    void selectModel(row.providerId, row.model.id).then(() => closePicker());
  }
</script>

{#snippet modelRow(row: Row, showProvider: boolean)}
  {@const badge = row.capability ? capabilityBadge(row.capability.status) : undefined}
  {@const reason = capabilityReason(row.capability)}
  {@const selectable = isSelectable(row.capability)}
  <Command.Item
    value={`${row.providerId}:${row.model.id}`}
    disabled={!selectable}
    onSelect={() => handlePickModel(row)}
    data-status={row.capability?.status ?? "unknown"}
    data-active={row.isActive}
    class={cn(
      "flex items-center justify-between gap-2 rounded-xl px-3 py-1.5",
      row.isActive && "border border-primary data-selected:bg-muted",
    )}
  >
    <span class="flex min-w-0 flex-1 flex-col gap-0">
      <span
        class={cn("truncate leading-tight text-foreground", !selectable && "text-muted-foreground")}
        dir="ltr"
      >
        {row.model.name}
      </span>
      {#if showProvider}
        <span class="text-xs leading-tight text-muted-foreground">{row.providerName}</span>
      {/if}
      {#if reason}
        <span class="text-xs leading-tight break-words text-muted-foreground">{reason}</span>
      {/if}
    </span>
    {#if row.isActive}
      <!-- The selected row is marked by a filled check, not only by its
           outline: a 1px border is easy to miss in a list where every row
           is a box. -->
      <span class="flex-none text-primary"><Icon name="check_circle" class="size-4" /></span>
    {:else if badge}
      <!-- Code-review fix on card 130: `text-muted-foreground` is the
           always-on base — matches the raw `<span>` this replaced and the
           same outline-Badge pattern elsewhere (CallLogEntry.svelte:145,
           ToolCallRow.svelte:218, AnnotationBadges.svelte:52). Without it,
           `Badge`'s own `text-foreground` won for Unverified/No-tool-support
           rows since only the tool-capable case was overriding color. -->
      <Badge
        variant="outline"
        class={cn(
          "flex-none whitespace-nowrap text-muted-foreground",
          row.capability?.status === "tool-capable" && "border-primary/30 text-primary",
        )}
      >
        {badge.icon} {badge.label}
      </Badge>
    {/if}
  </Command.Item>
{/snippet}

<!--
  Review fix on card 130 (MR !1, notes 12383 AND 12385 — both threads land on
  this one control, and the fix for one turned out to be the fix for both).

  Two earlier designs were tried and measured to fail:

  1. A real `<button aria-expanded>`, rendered via a new `headingContent`
     snippet slot on command-group.svelte so it sat as a SIBLING of
     `Command.GroupItems` rather than nested inside it (the position the
     plain-string `heading` prop already uses safely). Still failed:
     axe-core's `aria-required-children` flags ANY `role="button"`
     descendant of `role="listbox"` (`Command.List`, below) as a critical
     violation, at ANY nesting depth — `group` has no owned-elements
     restriction of its own for axe's check to stop at, so it's a
     pass-through, not a boundary. Confirmed live: even
     `<div role="group"><button>…</button></div>` still failed with
     "Element has children which are not allowed: button".
  2. A hand-rolled `<div role="group" tabindex="0" aria-expanded>` doing the
     button's job manually. This satisfied axe, but Svelte's OWN a11y linter
     (`svelte-check`) rejects it on three independent counts, all correct
     per the real WAI-ARIA spec (not just axe's specific rule coverage):
     `group` is a non-interactive/structural role (no `tabindex`, no
     click/keydown handlers), and — contrary to what its name might
     suggest — `group` does NOT support `aria-expanded` as a state at all.
     Passing axe this way was passing one checker by failing another, not a
     genuine fix.

  The actual constraint, once both of those failed: NEITHER role a listbox
  permits (`option` or `group`) supports `aria-expanded`. There is no valid
  way to nest an `aria-expanded`-bearing element inside `role="listbox"`.

  The fix that is genuinely correct: this disclosure is now a real
  `Command.Item` (`role="option"`) — the same primitive every selectable
  model row already uses, which is why it can live here at all. Its
  `onSelect` toggles the section instead of picking a model (and never
  calls `selectModel`/`closePicker`):
    - Enter now works through Command.Root's OWN existing mechanism (module
      doc comment above: "Enter activates the currently-highlighted row") —
      the exact interception that used to WRONGLY commit/close the picker
      is now correctly routed to THIS item's `onSelect`. No `stopPropagation`
      hack needed; Command.Root doing its normal job IS the fix.
    - Click goes through the same `onSelect` path Command.Item already
      wires internally.
    - Space is deliberately NOT handled here or anywhere else (review fix,
      MR !1 note 12450) — `role="option"` in a combobox+listbox is activated
      via Enter/click, not Space, and this picker's filter input needs Space
      to type normally. An earlier version intercepted Space centrally on
      Command.Root; it was deleted because it stole a space keystroke out of
      an in-progress filter query whenever the toggle happened to be the
      highlighted (typically first) option — see `handlePickModel`'s
      neighboring doc comment for the measured regression.
    - Enter/click landing on `onSelect` toggles the section correctly every
      time, including a SECOND activation to re-collapse (review fix, MR !1
      note 12449) — see `restoreDisclosureHighlight`'s doc comment above for
      why that needed its own fix: bits-ui silently steals the highlight off
      this item once the section's rows mount, and without correcting that,
      a second Enter/click would land on whatever row bits-ui picked instead
      of back on this toggle.
  Its accessible name comes from content, same as every other row here
  (`option` gets name-from-content; `group`, notably, does not) — there is
  no formal `aria-expanded` announcement (no listbox-permitted role
  supports it), so state is communicated the way a "Show more" option row
  in any real combobox already communicates it: the listbox's own visible
  row count changes when it activates.
  Verified with axe-core against Storybook's "Many unverified models (large
  gateway catalog)" AND "Grouped (selectable, unverified, no-tools)"
  stories, open picker: 0 `aria-required-children` violations on both
  (previously 1, critical, on the first), matching origin/main's baseline —
  and 0 new Svelte a11y warnings from `npm run check`.
-->
{#snippet collapsibleOption(
  sectionKey: "unverified-toggle" | "no-tools-toggle",
  label: string,
  count: number,
  expanded: boolean,
  toggle: () => void,
)}
  <Command.Item
    value={sectionKey}
    onSelect={toggle}
    class="sticky top-0 z-10 flex w-full items-center justify-between gap-2 rounded-none bg-popover px-2 py-1 text-start text-xs font-medium text-muted-foreground"
  >
    <span>{label} ({count})</span>
    <Icon
      name="expand_more"
      class={cn("size-4 flex-none transition-transform", expanded && "rotate-180")}
    />
  </Command.Item>
{/snippet}

<div class="relative min-w-0">
  <Popover.Root open={selection.pickerOpen} onOpenChange={(o) => (o ? openPicker() : closePicker())}>
    <!-- TODO: clean-code - 0.2 - COUPLING: `picker__trigger` (like ActivityGroup.svelte's `.activity-group`/`.summary`) is a class with no styling of its own kept only so scripts/verify/checks/screenshots.mjs can find the element — a magic-string contract with no compiler behind it. -->
    <!-- `picker__trigger` carries no styling of its own — kept purely so
         verify/checks/screenshots.mjs can open the model sheet for its
         screenshot matrix. The chip's own accessible name is whichever model
         is selected, which moves with the harness's seed data, so a class is
         the stable handle. Card 72 kept the hook and deleted the rest of the
         legacy names around it. -->
    <Popover.Trigger
      class={cn(
        "picker__trigger inline-flex max-w-[180px] min-w-0 items-center gap-1 rounded-full bg-secondary py-1 pe-1 ps-3 text-sm text-secondary-foreground",
        triggerInfo.variant === "muted" && "text-muted-foreground",
        triggerInfo.variant === "warning" && "text-destructive",
      )}
      title={triggerInfo.label}
      aria-label={triggerInfo.label}
    >
      <span class="min-w-0 truncate" dir={triggerTextIsModelId ? "ltr" : undefined}>{triggerText}</span>
      <Icon name="expand_more" class="size-4" />
    </Popover.Trigger>

    <Popover.Content
      side="top"
      dir={uiTextDirection()}
      align="end"
      sideOffset={8}
      aria-label={m.providerPicker_choosePopoverAriaLabel()}
      class="flex max-h-[60vh] w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-hidden"
      onOpenAutoFocus={handleOpenAutoFocus}
    >
      <p class="px-1 text-base font-medium tracking-tight text-foreground">{m.providerPicker_heading()}</p>
      {#if selection.providersStatus === "loading"}
        <p class="px-1 text-sm text-muted-foreground">{m.loadingProvidersLabel()}</p>
      {:else if selection.providers.length === 0}
        <div class="flex flex-col items-start gap-2 px-1">
          <p class="text-sm text-muted-foreground">{m.providerPicker_noProvidersMessage()}</p>
          <Button type="button" variant="secondary" size="sm" onclick={openOptionsPage}>
            {m.providerPicker_openOptionsAddOneAction()}
          </Button>
        </div>
      {:else}
        {#if selection.resolution.status === "dangling"}
          <p class="rounded-xl border border-destructive px-2 py-2 text-sm text-destructive">
            {m.providerPicker_danglingMessage()}
          </p>
        {/if}

        <Command.Root
          shouldFilter={false}
          bind:ref={commandRootEl}
          bind:value={highlightedValue}
          class="min-h-0 flex-1 gap-2 overflow-hidden rounded-none bg-transparent p-0"
        >
          {#if showFilter}
            <Command.Input
              bind:value={filterQuery}
              bind:ref={filterInputEl}
              placeholder={m.providerPicker_filterPlaceholder()}
              aria-label={m.providerPicker_filterAriaLabel()}
              class="p-0"
            />
          {/if}

          <!-- `py-1` matches the `p-1` shadcn's Command.Group already puts
               around each row (command-group.svelte), so the scroll
               boundary carries the same inset the rows themselves use —
               without it, the list was clipping mid-row exactly at the top/
               bottom edge with no cushion (card 89's visual QA note).
               `scroll-py-1` (from Command.List's own base class) only
               affects scroll-into-view margins, not this.

               `tabindex="0"` — review fix on card 130 (MR !1, note 12452):
               once a section expands, this region genuinely scrolls
               (scrollHeight > clientHeight) but had no keyboard focus target
               of its own — axe-core flagged it `scrollable-region-focusable`
               (serious), and a real keyboard walk confirmed it: 30x
               ArrowDown after expanding only ever visits the 2 toggle rows
               (Command's roving nav correctly skips the revealed rows, which
               are `aria-disabled` until selectable), and the container's own
               `scrollTop` never moved because nothing in it could take real
               focus. Making the region itself a tab stop gives keyboard users
               a way to reach it and scroll it directly, satisfying axe's
               rule, without touching Command's own roving-tabindex
               management of its child items — items never carry a
               `tabindex` of their own (see the module doc comment: real DOM
               focus stays on the input/root the whole time), so this doesn't
               compete with that mechanism.

               Review fix on card 130 (MR !1, note 12479): the paragraph
               above used to credit "arrow keys / Page Down" with doing the
               scrolling once this region is focused. Measured live in
               Chromium (Unverified expanded, scrollHeight 1928 / clientHeight
               321, focus on this element, scrollTop reset to 0 before each
               key): ArrowDown and End do NOT move `scrollTop` — Command.Root
               owns those for its own roving highlight and calls
               `preventDefault` before they ever reach the browser's native
               scroll behavior. Only PageDown and Space — the two keys
               Command doesn't claim for roving — actually move `scrollTop`
               (measured: both landed at 273). Space only does this while
               focus is on THIS element; the same key typed while focus is on
               the filter input above just types a space character (note
               12450's fix), it does not scroll anything. Arrow-key roving
               still bubbles from this element up to Command.Root's own
               `onkeydown` exactly as before, and Escape still closes the
               popover from here — none of that changed, only the claim about
               which keys scroll the region. -->
          <Command.List
            tabindex={0}
            bind:ref={commandListEl}
            class="flex min-h-0 max-h-full flex-1 flex-col gap-3 overflow-y-auto py-1"
          >
            {#each visibleGroups as group (group.provider.id)}
              <Command.Group value={group.provider.id} heading={group.provider.name} class="flex flex-col gap-1 p-0">
                {#if group.filteredSelectable.length > 0}
                  {#each group.filteredSelectable as row (`${row.providerId}:${row.model.id}`)}
                    {@render modelRow(row, false)}
                  {/each}
                {/if}

                {#if !group.state || group.state.status === "loading"}
                  <p class="px-2 text-sm text-muted-foreground">{m.providerPicker_checkingModels()}</p>
                {:else if group.state.status === "error"}
                  <p class="rounded-xl border border-destructive px-2 py-2 text-sm text-destructive">
                    {group.state.message}
                  </p>
                  {#if group.state.error.kind === "unreachable-or-cors" && group.state.error.fix}
                    {@const fix = group.state.error.fix}
                    <p class="px-2 text-sm text-muted-foreground">{fix.label}:</p>
                    <Markdown source={fenceOf(fix.command)} />
                  {:else if group.state.error.kind === "auth"}
                    <Button type="button" variant="link" size="sm" class="h-auto px-2" onclick={openOptionsPage}>
                      {m.providerPicker_openOptionsCheckApiKeyAction()}
                    </Button>
                  {/if}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    class="h-auto self-start px-2"
                    onclick={() => reloadModels(group.provider.id)}
                  >
                    {m.retryAction()}
                  </Button>
                {:else if group.state.status === "not-supported"}
                  <p class="px-2 text-sm text-muted-foreground">{group.state.message}</p>
                  <form class="flex gap-1 px-2" onsubmit={(e) => handleManualSubmit(group.provider.id, e)}>
                    <Input
                      type="text"
                      placeholder={m.providerPicker_modelIdPlaceholder()}
                      aria-label={m.providerPicker_modelIdAriaLabel({ provider: group.provider.name })}
                      class="min-w-0 flex-1 text-sm"
                      value={manualModelInputs[group.provider.id] ?? ""}
                      oninput={(e) =>
                        (manualModelInputs[group.provider.id] = (e.currentTarget as HTMLInputElement).value)}
                    />
                    <Button type="submit" variant="secondary" size="sm">{m.providerPicker_checkAction()}</Button>
                  </form>
                  {#if group.state.manualEntry && !isSelectable(group.state.manualEntry.capability)}
                    <!-- A SELECTABLE manual entry already rendered above, in
                         filteredSelectable (it's part of `allRows` too) — this
                         only covers the unverified/no-tools outcome, so the
                         result isn't shown twice. -->
                    {@render modelRow(toRow(group.provider, group.state.manualEntry), false)}
                  {/if}
                {:else if group.state.status === "loaded" && group.state.entries.length === 0}
                  <p class="px-2 text-sm text-muted-foreground">
                    {m.providerPicker_noModelsMessage()}
                    {#if group.provider.type === "ollama"}
                      {m.providerPicker_pullModelHintPrefix()}<code
                        >ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code
                      >{m.providerPicker_pullModelHintSuffix()}
                    {/if}
                  </p>
                  {#if group.provider.type === "ollama"}
                    <Markdown source={fenceOf(`ollama pull ${OLLAMA_TOOL_MODEL_SUGGESTION}`)} />
                  {/if}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    class="h-auto self-start px-2"
                    onclick={() => reloadModels(group.provider.id)}
                  >
                    {m.retryAction()}
                  </Button>
                {/if}
              </Command.Group>
            {/each}

            {#if unverifiedRows.length > 0}
              <!-- Review fix on card 130 (MR !1, note 12451): `heading` IS
                   passed here now, with `headingHidden` — command-group.svelte
                   renders that `GroupHeading` `sr-only` instead of its normal
                   visible classes, so the group gets a real, non-empty
                   `aria-labelledby` (this was previously skipped entirely,
                   leaving the group unnamed — see the doc comment near this
                   file's top for the full history) without a second, VISIBLE
                   copy of "Unverified (24)" alongside the disclosure item's
                   own on-screen text below. -->
              <Command.Group
                value="unverified"
                heading={m.providerPicker_unverifiedHeading()}
                headingHidden
                class="flex flex-col gap-1 p-0"
              >
                {@render collapsibleOption(
                  "unverified-toggle",
                  m.providerPicker_unverifiedHeading(),
                  unverifiedRows.length,
                  unverifiedEffectivelyExpanded,
                  toggleUnverifiedDisclosure,
                )}
                {#if unverifiedEffectivelyExpanded}
                  {#each unverifiedRows as row (`${row.providerId}:${row.model.id}`)}
                    {@render modelRow(row, true)}
                  {/each}
                {/if}
              </Command.Group>
            {/if}

            {#if noToolsRows.length > 0}
              <!-- See the matching comment on the Unverified group above:
                   sr-only `heading` for a real accessible name, same reason. -->
              <Command.Group
                value="no-tools"
                heading={m.providerPicker_noToolSupportHeading()}
                headingHidden
                class="flex flex-col gap-1 p-0"
              >
                {@render collapsibleOption(
                  "no-tools-toggle",
                  m.providerPicker_noToolSupportHeading(),
                  noToolsRows.length,
                  noToolsEffectivelyExpanded,
                  toggleNoToolsDisclosure,
                )}
                <!-- Review fix on card 130 (MR !1, note 12386): this hint has
                     to render whenever `noToolsHasOllama` is true regardless
                     of collapse state — decisions/43 only authorises
                     collapsing the ROWS ("only the individual rows require
                     one click to reach"), and card 14 requires this
                     concrete, copyable fix to stay reachable for the exact
                     case where a user's only provider has zero tool-capable
                     models. Previously swept inside the expand-gate below by
                     mistake; matches origin/main's pre-card-130 behaviour
                     (always rendered whenever the section exists) now. -->
                {#if noToolsHasOllama}
                  <p class="px-2 text-sm text-muted-foreground">
                    {m.providerPicker_pullToolCapableHintPrefix()}<code
                      >ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code
                    >{m.providerPicker_pullToolCapableHintSuffix()}
                  </p>
                {/if}
                {#if noToolsEffectivelyExpanded}
                  {#each noToolsRows as row (`${row.providerId}:${row.model.id}`)}
                    {@render modelRow(row, true)}
                  {/each}
                {/if}
              </Command.Group>
            {/if}

            {#if visibleGroups.length === 0 && unverifiedRows.length === 0 && noToolsRows.length === 0}
              <p class="px-2 py-4 text-sm text-muted-foreground"
                >{m.providerPicker_noMatchMessage({ query: filterQuery })}</p
              >
            {/if}
          </Command.List>
        </Command.Root>

        <!-- A real Separator above the footer row, not a border-t utility —
             gives the "Refresh"/"Manage providers…" row a clean break from
             the scrollable list above it (card 89's visual QA note). -->
        <Separator />

        <div class="flex justify-between gap-2 pt-2">
          <Button type="button" variant="link" size="sm" class="h-auto px-0" onclick={refresh}
            >{m.providerPicker_refreshAction()}</Button
          >
          <Button type="button" variant="link" size="sm" class="h-auto px-0" onclick={openOptionsPage}>
            {m.providerPicker_manageProvidersAction()}
          </Button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
</div>
