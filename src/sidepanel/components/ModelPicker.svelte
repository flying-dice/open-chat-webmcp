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

  // Card 130 / decisions/43: the Unverified and No-tool-support sections
  // start collapsed behind a heading stating their count, and expand in
  // place on click. Both start collapsed — reset alongside the filter query
  // whenever the popover closes (see the `$effect` below) so each open
  // starts from the same condensed state rather than remembering the last
  // session's expansion.
  let unverifiedExpanded = $state(false);
  let noToolsExpanded = $state(false);

  /**
   * Code-review fix on card 130: the Unverified/No-tool-support
   * `Command.Group`s dropped their `heading` string prop for the
   * interactive `collapsibleHeading` button below, so bits-ui's own
   * `Command.GroupHeading` wiring (which only fires for that string prop —
   * see command-group.svelte) never ran and the group's `role="group"`
   * element (`Command.GroupItems`, per bits-ui's command.svelte.js) got no
   * `aria-labelledby` at all — a screen reader announced an unnamed
   * "group" instead of "Unverified"/"No tool support". Fixed by giving the
   * button its own id and wiring it through command-group.svelte's new
   * `headingId` prop, which forwards straight to `Command.GroupItems`'
   * `aria-labelledby` (see that file's comment). `$props.id()` keeps the
   * ids unique per mounted ModelPicker instance (e.g. two Storybook
   * stories mounted side by side) without a global counter.
   */
  const uid = $props.id();
  const unverifiedHeadingId = `${uid}-unverified-heading`;
  const noToolsHeadingId = `${uid}-no-tools-heading`;

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
   * Code-review fix on card 130 (post-decisions/43): `unverifiedRows`/
   * `noToolsRows` above are already filtered by the query, so typing e.g.
   * "gateway-model-7" correctly narrows a collapsed heading down to
   * "Unverified (1)" — but with only the raw `unverifiedExpanded`/
   * `noToolsExpanded` toggle gating the rows, the match stayed hidden
   * behind the still-collapsed section, forcing an extra click to actually
   * see it. These two derive "effectively expanded" as the manual toggle
   * OR'd with "a filter is active and left at least one row in this
   * section" — deliberately NOT an `$effect` that mutates
   * `unverifiedExpanded`/`noToolsExpanded` directly, which would fight a
   * manual collapse-during-filter click every time it re-ran. Because nothing
   * ever overwrites the raw toggle, clicking the heading always flips a
   * stable, independent piece of state; a filtered-open section reverts to
   * collapsed the moment the query is cleared (or the popover closes, which
   * already resets the raw toggle above) purely because the OR's second
   * term goes false, with no separate reset needed here.
   */
  const filtering = $derived(normalizedQuery() !== "");
  const unverifiedEffectivelyExpanded = $derived(
    unverifiedExpanded || (filtering && unverifiedRows.length > 0),
  );
  const noToolsEffectivelyExpanded = $derived(
    noToolsExpanded || (filtering && noToolsRows.length > 0),
  );

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
  Card 130 / decisions/43: a clickable, sticky disclosure heading for the
  Unverified/No-tool-support sections, standing in for `Command.Group`'s own
  `heading` prop (which only renders static text, not a control). Composes
  the existing bucket-heading string with the row count client-side rather
  than adding a new i18n key. "Never hide, always show-with-reason"
  (decisions/06/11, refined by decisions/43) is kept: the section is never
  gone, only condensed behind a heading that states exactly how many rows it
  holds.
-->
{#snippet collapsibleHeading(
  headingId: string,
  label: string,
  count: number,
  expanded: boolean,
  toggle: () => void,
)}
  <!-- Code-review fix on card 130: `id={headingId}` is what
       command-group.svelte's `headingId` prop points the surrounding
       `Command.Group`'s `aria-labelledby` at — see the doc comment on
       `unverifiedHeadingId`/`noToolsHeadingId` above. -->
  <button
    id={headingId}
    type="button"
    class="sticky top-0 z-10 flex w-full items-center justify-between gap-2 bg-popover px-2 py-1 text-start text-xs font-medium text-muted-foreground"
    aria-expanded={expanded}
    onclick={toggle}
  >
    <span>{label} ({count})</span>
    <Icon
      name="expand_more"
      class={cn("size-4 flex-none transition-transform", expanded && "rotate-180")}
    />
  </button>
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
               affects scroll-into-view margins, not this. -->
          <Command.List class="flex min-h-0 max-h-full flex-1 flex-col gap-3 overflow-y-auto py-1">
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
              <Command.Group value="unverified" headingId={unverifiedHeadingId} class="flex flex-col gap-1 p-0">
                {@render collapsibleHeading(
                  unverifiedHeadingId,
                  m.providerPicker_unverifiedHeading(),
                  unverifiedRows.length,
                  unverifiedEffectivelyExpanded,
                  () => (unverifiedExpanded = !unverifiedExpanded),
                )}
                {#if unverifiedEffectivelyExpanded}
                  {#each unverifiedRows as row (`${row.providerId}:${row.model.id}`)}
                    {@render modelRow(row, true)}
                  {/each}
                {/if}
              </Command.Group>
            {/if}

            {#if noToolsRows.length > 0}
              <Command.Group value="no-tools" headingId={noToolsHeadingId} class="flex flex-col gap-1 p-0">
                {@render collapsibleHeading(
                  noToolsHeadingId,
                  m.providerPicker_noToolSupportHeading(),
                  noToolsRows.length,
                  noToolsEffectivelyExpanded,
                  () => (noToolsExpanded = !noToolsExpanded),
                )}
                {#if noToolsEffectivelyExpanded}
                  {#if noToolsHasOllama}
                    <p class="px-2 text-sm text-muted-foreground">
                      {m.providerPicker_pullToolCapableHintPrefix()}<code
                        >ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code
                      >{m.providerPicker_pullToolCapableHintSuffix()}
                    </p>
                  {/if}
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
