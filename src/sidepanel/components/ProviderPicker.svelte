<script lang="ts">
  /**
   * The composer's flat model picker (card 51, decisions/22-flat-model-picker.md
   * — refining card 23's two-level provider-then-model control). A compact
   * chip in the composer's action row opens a sheet ABOVE it, showing every
   * configured provider's models as ONE list:
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
    togglePicker,
    type ModelListEntry,
    type ModelsState,
  } from "../stores/selection.svelte";
  import { panel } from "../stores/panel.svelte";
  import Markdown from "../../lib/components/Markdown.svelte";
  import Icon from "./Icon.svelte";
  import {
    capabilityBadge,
    isSelectable,
    reasonForCapability,
  } from "../../lib/providers/capability";
  import type { ProviderConfig } from "../../lib/providers/registry";
  import type { ModelCapabilities, ProviderModel } from "../../lib/provider";

  /**
   * Wrap a copy-pasteable command as a fenced code block so it renders
   * through Markdown.svelte's existing code-block pipeline (src/lib/markdown.ts's
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
  let rootEl: HTMLDivElement | undefined = $state();
  let filterInputEl: HTMLInputElement | undefined = $state();

  /** A current tool-calling-capable Ollama model, named concretely per card 14 rather than leaving "pull a model" vague. */
  const OLLAMA_TOOL_MODEL_SUGGESTION = "llama3.1";

  // Keep the store pointed at whichever tab is active. panel.pageInfo is
  // owned by src/sidepanel/services/activeTab.ts; this only reads it.
  $effect(() => {
    const info = panel.pageInfo;
    if (info) void syncToTab(info.tabId, info.origin);
  });

  $effect(() => {
    if (!selection.pickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootEl && e.target instanceof Node && !rootEl.contains(e.target)) closePicker();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeydown);
    };
  });

  // Reset the filter between opens, and land keyboard focus somewhere
  // useful the moment the sheet appears — the filter box when there is one
  // (decisions/22: "filter" is one of the keyboard affordances this picker
  // has to keep), otherwise the first selectable row.
  $effect(() => {
    if (!selection.pickerOpen) {
      filterQuery = "";
      return;
    }
    void tick().then(() => {
      if (filterInputEl) filterInputEl.focus();
      else firstEnabledRowEl()?.focus();
    });
  });

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
    if (r.status === "ok" && !selection.needsConfirmation) return r.model;
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

  // ---- Keyboard: arrow-key roving focus across enabled rows ------------

  function allRowEls(): HTMLButtonElement[] {
    return rootEl ? Array.from(rootEl.querySelectorAll<HTMLButtonElement>(".model-row:not(:disabled)")) : [];
  }

  function firstEnabledRowEl(): HTMLButtonElement | undefined {
    return allRowEls()[0];
  }

  function handleRowKeydown(e: KeyboardEvent): void {
    const rows = allRowEls();
    const idx = rows.indexOf(e.currentTarget as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rows[idx + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx <= 0) filterInputEl?.focus();
      else rows[idx - 1]?.focus();
    }
  }

  function handleFilterKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      firstEnabledRowEl()?.focus();
    } else if (e.key === "Enter") {
      // Gemini/VS Code Chat's own filter-then-Enter shortcut: pick the top
      // match directly rather than making the user tab down to it.
      e.preventDefault();
      firstEnabledRowEl()?.click();
    }
  }
</script>

{#snippet modelRow(row: Row, showProvider: boolean)}
  {@const badge = row.capability ? capabilityBadge(row.capability.status) : undefined}
  {@const reason = reasonForCapability(row.capability)}
  {@const selectable = isSelectable(row.capability)}
  <li>
    <button
      type="button"
      class="model-row"
      data-status={row.capability?.status ?? "unknown"}
      data-active={row.isActive}
      disabled={!selectable}
      onclick={() => handlePickModel(row)}
      onkeydown={handleRowKeydown}
    >
      <span class="model-row__text">
        <span class="model-row__name">{row.model.name}</span>
        {#if showProvider}
          <span class="model-row__provider">{row.providerName}</span>
        {/if}
        {#if reason}
          <span class="model-row__reason">{reason}</span>
        {/if}
      </span>
      {#if row.isActive}
        <!-- The selected row is marked by a filled check, not only by its
             outline: a 1px border is easy to miss in a list where every row
             is a box. -->
        <span class="model-row__check"><Icon name="check_circle" size={20} /></span>
      {:else if badge}
        <span class="model-row__badge">{badge.icon} {badge.label}</span>
      {/if}
    </button>
  </li>
{/snippet}

<div class="picker" bind:this={rootEl}>
  <button
    type="button"
    class="picker__trigger"
    data-variant={triggerInfo.variant}
    aria-haspopup="dialog"
    aria-expanded={selection.pickerOpen}
    onclick={togglePicker}
    title={triggerInfo.label}
    aria-label={triggerInfo.label}
  >
    <span class="picker__trigger-label">{triggerText}</span>
    <Icon name="expand_more" size={18} />
  </button>

  {#if selection.pickerOpen}
    <div class="picker__panel" role="dialog" aria-label="Choose a model">
      <p class="picker__title">Choose your model</p>
      {#if selection.providersStatus === "loading"}
        <p class="hint">Loading providers…</p>
      {:else if selection.providers.length === 0}
        <div class="empty-state">
          <p>No providers are registered yet.</p>
          <button type="button" onclick={openOptionsPage}>Open options to add one</button>
        </div>
      {:else}
        {#if selection.resolution.status === "dangling"}
          <p class="banner banner--warning">
            The provider this chat was using has been removed. Pick a replacement below —
            your conversation is kept.
          </p>
        {/if}

        {#if showFilter}
          <input
            type="text"
            class="filter-input"
            placeholder="Filter models…"
            bind:value={filterQuery}
            bind:this={filterInputEl}
            onkeydown={handleFilterKeydown}
            aria-label="Filter models"
          />
        {/if}

        <div class="picker__list">
          {#each visibleGroups as group (group.provider.id)}
            <div class="group">
              <div class="group__heading">{group.provider.name}</div>

              {#if group.filteredSelectable.length > 0}
                <ul class="model-list">
                  {#each group.filteredSelectable as row (row.model.id)}
                    {@render modelRow(row, false)}
                  {/each}
                </ul>
              {/if}

              {#if !group.state || group.state.status === "loading"}
                <p class="hint">Checking models…</p>
              {:else if group.state.status === "error"}
                <p class="banner banner--error">{group.state.message}</p>
                {#if group.state.error.kind === "unreachable-or-cors" && group.state.error.fix}
                  {@const fix = group.state.error.fix}
                  <p class="hint">{fix.label}:</p>
                  <Markdown source={fenceOf(fix.command)} />
                {:else if group.state.error.kind === "auth"}
                  <button type="button" onclick={openOptionsPage}>Open options to check the API key</button>
                {/if}
                <button type="button" class="link-btn" onclick={() => reloadModels(group.provider.id)}>Retry</button>
              {:else if group.state.status === "not-supported"}
                <p class="hint">{group.state.message}</p>
                <form class="manual-entry" onsubmit={(e) => handleManualSubmit(group.provider.id, e)}>
                  <input
                    type="text"
                    placeholder="Model id, e.g. gpt-4o-mini"
                    aria-label={`Model id for ${group.provider.name}`}
                    value={manualModelInputs[group.provider.id] ?? ""}
                    oninput={(e) =>
                      (manualModelInputs[group.provider.id] = (e.currentTarget as HTMLInputElement).value)}
                  />
                  <button type="submit">Check</button>
                </form>
                {#if group.state.manualEntry && !isSelectable(group.state.manualEntry.capability)}
                  <!-- A SELECTABLE manual entry already rendered above, in
                       filteredSelectable (it's part of `allRows` too) — this
                       only covers the unverified/no-tools outcome, so the
                       result isn't shown twice. -->
                  <ul class="model-list">
                    {@render modelRow(toRow(group.provider, group.state.manualEntry), false)}
                  </ul>
                {/if}
              {:else if group.state.status === "loaded" && group.state.entries.length === 0}
                <p class="hint">
                  This provider has no models installed yet.
                  {#if group.provider.type === "ollama"}
                    Pull one to get started, e.g. <code>ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code>.
                  {/if}
                </p>
                {#if group.provider.type === "ollama"}
                  <Markdown source={fenceOf(`ollama pull ${OLLAMA_TOOL_MODEL_SUGGESTION}`)} />
                {/if}
                <button type="button" class="link-btn" onclick={() => reloadModels(group.provider.id)}>Retry</button>
              {/if}
            </div>
          {/each}

          {#if unverifiedRows.length > 0}
            <div class="group">
              <div class="group__heading">Unverified</div>
              <ul class="model-list">
                {#each unverifiedRows as row (`${row.providerId}:${row.model.id}`)}
                  {@render modelRow(row, true)}
                {/each}
              </ul>
            </div>
          {/if}

          {#if noToolsRows.length > 0}
            <div class="group">
              <div class="group__heading">No tool support</div>
              {#if noToolsHasOllama}
                <p class="hint">
                  Pull a tool-capable model to use it here, e.g.
                  <code>ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code>.
                </p>
              {/if}
              <ul class="model-list">
                {#each noToolsRows as row (`${row.providerId}:${row.model.id}`)}
                  {@render modelRow(row, true)}
                {/each}
              </ul>
            </div>
          {/if}

          {#if visibleGroups.length === 0 && unverifiedRows.length === 0 && noToolsRows.length === 0}
            <p class="hint">No models match “{filterQuery}”.</p>
          {/if}
        </div>

        <div class="picker__footer">
          <button type="button" class="link-btn" onclick={refresh}>Refresh</button>
          <button type="button" class="link-btn" onclick={openOptionsPage}>Manage providers…</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .picker {
    position: relative;
    min-width: 0;
  }

  /* The chip in the composer's action row. Clamped to whichever is
     smaller: a 180px cap, or whatever width the row actually shrank
     `.picker` to — a plain <button> doesn't inherit a flex item's shrunk
     width on its own, so without this it sizes up to the flat cap and
     overflows instead of ellipsizing within it. */
  .picker__trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: min(180px, 100%);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    background: var(--color-surface-container-high);
    color: var(--color-on-surface);
    font-size: var(--font-size-small);
    min-width: 0;
  }

  .picker__trigger-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .picker__trigger[data-variant="muted"] {
    color: var(--color-on-surface-variant);
  }

  .picker__trigger[data-variant="warning"] {
    color: var(--color-danger);
  }

  /* The sheet opens UPWARDS: the chip sits at the bottom of the panel, and
     a menu dropping down from it would have nowhere to go. It anchors to
     `.picker`, which is inside the composer — deliberately outside the
     transcript's scroller, so nothing clips it. */
  .picker__panel {
    position: absolute;
    bottom: calc(100% + var(--space-2));
    right: 0;
    z-index: 10;
    width: 320px;
    max-width: calc(100vw - var(--space-4));
    max-height: 60vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--color-surface-container);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    box-shadow: var(--elevation-3);
  }

  .picker__title {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-heading);
    color: var(--color-on-surface-variant);
  }

  .picker__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .filter-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-outline);
    background: var(--color-surface);
    color: var(--color-on-surface);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-small);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .group__heading {
    font-size: var(--font-size-small);
    font-weight: 600;
    color: var(--color-on-surface-variant);
  }

  .hint {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
  }

  .banner {
    margin: 0;
    font-size: var(--font-size-small);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    background: var(--color-surface-container);
    border: 1px solid var(--color-outline);
  }

  .banner--warning {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .banner--error {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .hint code {
    font-size: inherit;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .empty-state p {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
  }

  .model-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .model-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    text-align: left;
    border-radius: var(--radius-card);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    /* Transparent rather than absent so selecting a row doesn't shift the
       list by 2px. */
    border: 1px solid transparent;
    min-width: 0;
  }

  .model-row:hover:not(:disabled) {
    background: var(--state-hover);
  }

  .model-row[data-active="true"],
  .model-row[data-active="true"]:hover {
    border-color: var(--color-primary);
    background: var(--state-hover);
  }

  .model-row__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .model-row__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--color-on-surface);
  }

  .model-row:disabled .model-row__name {
    color: var(--color-on-surface-variant);
  }

  /* Rows in the Unverified/No-tool-support groups carry their provider as
     secondary text, since they're no longer under a provider heading
     (decisions/22). */
  .model-row__provider {
    font-size: var(--font-size-caption);
    color: var(--color-on-surface-variant);
  }

  .model-row__badge {
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    white-space: nowrap;
  }

  .model-row[data-status="tool-capable"] .model-row__badge {
    color: var(--color-primary);
  }

  .model-row__check {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--color-primary);
  }

  /* The row's second line: why this model is or isn't usable. Wraps rather
     than ellipsizing — a truncated reason is no reason at all. */
  .model-row__reason {
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
    overflow-wrap: anywhere;
  }

  .manual-entry {
    display: flex;
    gap: var(--space-1);
  }

  .manual-entry input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .picker__footer {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    border-top: 1px solid var(--color-outline-variant);
    padding-top: var(--space-3);
    margin-top: var(--space-1);
  }

  .link-btn {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--color-primary);
    font-size: var(--font-size-small);
  }

  .link-btn:hover {
    background: transparent;
    text-decoration: underline;
  }
</style>
