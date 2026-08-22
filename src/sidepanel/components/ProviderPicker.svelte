<script lang="ts">
  // TODO: clean-code - 0.5 - NAMING: named ProviderPicker but card 51/decisions-22 flattened it into a single MODEL picker grouped by provider — heading reads "Choose your model", selectModel/ModelListEntry are the vocabulary throughout. Should say it picks a model.
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
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Separator } from "$lib/components/ui/separator";
  import { cn } from "$lib/utils";
  import {
    isSelectable,
    isSelectionUsable,
    reasonForCapability,
    type ModelCapabilities,
    type ProviderModel,
  } from "../../domain/providers";
  import { capabilityBadge } from "../presentation/capabilityBadge";
  import type { ProviderConfig } from "../../domain/providers";

  /**
   * Wrap a copy-pasteable command as a fenced code block so it renders
   * through Markdown.svelte's existing code-block pipeline (src/ui/markdown.ts's
   * `renderCodeBlock`) — that pipeline already gives every fenced block its
   * own working "Copy"/"Copied" button, so this reuses that exact,
   * already-tested affordance instead of hand-rolling a second one
   * (card 14: "make the fix copyable, not just described").
   */
  function fenceOf(command: string): string {
    return "```\n" + command + "\n```";
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

  /** A current tool-calling-capable Ollama model, named concretely per card 14 rather than leaving "pull a model" vague. */
  const OLLAMA_TOOL_MODEL_SUGGESTION = "llama3.1";

  // Keep the store pointed at whichever tab is active. panel.pageInfo is
  // owned by src/infra/chrome-runtime/tab-sync.ts; this only reads it.
  $effect(() => {
    const info = panel.pageInfo;
    if (info) void syncToTab(info.tabId, info.origin);
  });

  // Reset the filter between opens.
  $effect(() => {
    if (!selection.pickerOpen) filterQuery = "";
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

  const triggerInfo = $derived.by((): { label: string; variant: "normal" | "muted" | "warning" } => {
    if (selection.providersStatus === "loading") return { label: "Loading providers…", variant: "muted" };
    if (selection.providers.length === 0) return { label: "No provider — set up in options", variant: "warning" };
    const r = selection.resolution;
    if (r.status === "dangling") return { label: "Provider removed — choose one", variant: "warning" };
    if (r.status === "none") return { label: "Choose a model", variant: "muted" };
    // Card 35: still needs a one-click confirmation before it can send —
    // flag that on the trigger chip too, not just in the composer.
    if (selection.needsConfirmation) {
      return { label: `Confirm ${r.config.name} · ${r.model}`, variant: "warning" };
    }
    return { label: `${r.config.name} · ${r.model}`, variant: "normal" };
  });

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
  // TODO: clean-code - 0.35 - SRP: mixes popover open/close + keyboard/filter UI with row-bucketing/grouping business logic (toRow, bucketOf, groups, visibleGroups, unverifiedRows, noToolsRows) in one file.
  function bucketOf(capability: ModelCapabilities | undefined): "selectable" | "unverified" | "no-tools" {
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
        filteredSelectable: g.selectableRows.filter((r) => matchesQuery(g.provider.name, r.model.id)),
      }))
      .filter((g) => {
        if (g.filteredSelectable.length > 0) return true;
        const q = normalizedQuery();
        if (q && !providerNameMatches(g.provider.name)) return false;
        return !g.state || g.state.status !== "loaded" || g.state.entries.length === 0;
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

  function handlePickModel(row: Row): void {
    if (!isSelectable(row.capability)) return;
    void selectModel(row.providerId, row.model.id).then(() => closePicker());
  }
</script>

{#snippet modelRow(row: Row, showProvider: boolean)}
  {@const badge = row.capability ? capabilityBadge(row.capability.status) : undefined}
  {@const reason = reasonForCapability(row.capability)}
  {@const selectable = isSelectable(row.capability)}
  <Command.Item
    value={`${row.providerId}:${row.model.id}`}
    disabled={!selectable}
    onSelect={() => handlePickModel(row)}
    data-status={row.capability?.status ?? "unknown"}
    data-active={row.isActive}
    class={cn(
      "flex items-center justify-between gap-2 rounded-xl px-3 py-2",
      row.isActive && "border border-primary data-selected:bg-muted",
    )}
  >
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class={cn("truncate text-foreground", !selectable && "text-muted-foreground")}>
        {row.model.name}
      </span>
      {#if showProvider}
        <span class="text-xs text-muted-foreground">{row.providerName}</span>
      {/if}
      {#if reason}
        <span class="text-sm break-words text-muted-foreground">{reason}</span>
      {/if}
    </span>
    {#if row.isActive}
      <!-- The selected row is marked by a filled check, not only by its
           outline: a 1px border is easy to miss in a list where every row
           is a box. -->
      <span class="flex-none text-primary"><Icon name="check_circle" size={20} /></span>
    {:else if badge}
      <span
        class={cn(
          "flex-none text-sm whitespace-nowrap text-muted-foreground",
          row.capability?.status === "tool-capable" && "text-primary",
        )}
      >
        {badge.icon} {badge.label}
      </span>
    {/if}
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
        "picker__trigger inline-flex max-w-[180px] min-w-0 items-center gap-1 rounded-full bg-secondary py-1 pr-1 pl-3 text-sm text-secondary-foreground",
        triggerInfo.variant === "muted" && "text-muted-foreground",
        triggerInfo.variant === "warning" && "text-destructive",
      )}
      title={triggerInfo.label}
      aria-label={triggerInfo.label}
    >
      <span class="min-w-0 truncate">{triggerText}</span>
      <Icon name="expand_more" size={18} />
    </Popover.Trigger>

    <Popover.Content
      side="top"
      align="end"
      sideOffset={8}
      aria-label="Choose a model"
      class="flex max-h-[60vh] w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-hidden"
      onOpenAutoFocus={handleOpenAutoFocus}
    >
      <p class="px-1 text-base font-medium text-muted-foreground">Choose your model</p>
      {#if selection.providersStatus === "loading"}
        <p class="px-1 text-sm text-muted-foreground">Loading providers…</p>
      {:else if selection.providers.length === 0}
        <div class="flex flex-col items-start gap-2 px-1">
          <p class="text-sm text-muted-foreground">No providers are registered yet.</p>
          <Button type="button" variant="secondary" size="sm" onclick={openOptionsPage}>
            Open options to add one
          </Button>
        </div>
      {:else}
        {#if selection.resolution.status === "dangling"}
          <p class="rounded-xl border border-destructive px-2 py-2 text-sm text-destructive">
            The provider this chat was using has been removed. Pick a replacement below —
            your conversation is kept.
          </p>
        {/if}

        <Command.Root shouldFilter={false} bind:ref={commandRootEl} class="flex-1 gap-2 overflow-hidden rounded-none bg-transparent p-0">
          {#if showFilter}
            <Command.Input
              bind:value={filterQuery}
              bind:ref={filterInputEl}
              placeholder="Filter models…"
              aria-label="Filter models"
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
          <Command.List class="flex max-h-full flex-col gap-3 overflow-y-auto py-1">
            {#each visibleGroups as group (group.provider.id)}
              <Command.Group value={group.provider.id} heading={group.provider.name} class="flex flex-col gap-1 p-0">
                {#if group.filteredSelectable.length > 0}
                  {#each group.filteredSelectable as row (`${row.providerId}:${row.model.id}`)}
                    {@render modelRow(row, false)}
                  {/each}
                {/if}

                {#if !group.state || group.state.status === "loading"}
                  <p class="px-2 text-sm text-muted-foreground">Checking models…</p>
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
                      Open options to check the API key
                    </Button>
                  {/if}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    class="h-auto self-start px-2"
                    onclick={() => reloadModels(group.provider.id)}
                  >
                    Retry
                  </Button>
                {:else if group.state.status === "not-supported"}
                  <p class="px-2 text-sm text-muted-foreground">{group.state.message}</p>
                  <form class="flex gap-1 px-2" onsubmit={(e) => handleManualSubmit(group.provider.id, e)}>
                    <Input
                      type="text"
                      placeholder="Model id, e.g. gpt-4o-mini"
                      aria-label={`Model id for ${group.provider.name}`}
                      class="min-w-0 flex-1"
                      value={manualModelInputs[group.provider.id] ?? ""}
                      oninput={(e) =>
                        (manualModelInputs[group.provider.id] = (e.currentTarget as HTMLInputElement).value)}
                    />
                    <Button type="submit" variant="secondary" size="sm">Check</Button>
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
                    This provider has no models installed yet.
                    {#if group.provider.type === "ollama"}
                      Pull one to get started, e.g. <code>ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code>.
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
                    Retry
                  </Button>
                {/if}
              </Command.Group>
            {/each}

            {#if unverifiedRows.length > 0}
              <Command.Group value="unverified" heading="Unverified" class="flex flex-col gap-1 p-0">
                {#each unverifiedRows as row (`${row.providerId}:${row.model.id}`)}
                  {@render modelRow(row, true)}
                {/each}
              </Command.Group>
            {/if}

            {#if noToolsRows.length > 0}
              <Command.Group value="no-tools" heading="No tool support" class="flex flex-col gap-1 p-0">
                {#if noToolsHasOllama}
                  <p class="px-2 text-sm text-muted-foreground">
                    Pull a tool-capable model to use it here, e.g.
                    <code>ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code>.
                  </p>
                {/if}
                {#each noToolsRows as row (`${row.providerId}:${row.model.id}`)}
                  {@render modelRow(row, true)}
                {/each}
              </Command.Group>
            {/if}

            {#if visibleGroups.length === 0 && unverifiedRows.length === 0 && noToolsRows.length === 0}
              <p class="px-2 py-4 text-sm text-muted-foreground">No models match "{filterQuery}".</p>
            {/if}
          </Command.List>
        </Command.Root>

        <!-- A real Separator above the footer row, not a border-t utility —
             gives the "Refresh"/"Manage providers…" row a clean break from
             the scrollable list above it (card 89's visual QA note). -->
        <Separator />

        <div class="flex justify-between gap-2 pt-2">
          <Button type="button" variant="link" size="sm" class="h-auto px-0" onclick={refresh}>Refresh</Button>
          <Button type="button" variant="link" size="sm" class="h-auto px-0" onclick={openOptionsPage}>
            Manage providers…
          </Button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Root>
</div>
