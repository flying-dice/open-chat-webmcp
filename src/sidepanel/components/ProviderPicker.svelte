<script lang="ts">
  /**
   * Two-level provider/model picker (card 23) — mounted into
   * src/sidepanel/components/Header.svelte's `picker` snippet slot. A
   * single compact trigger chip (per Header's slot contract) that opens a
   * popover with level 1 (provider `<select>`) and level 2 (model list,
   * partitioned tool-capable / no-tools / unknown per
   * decisions/11-provider-capability-detection.md).
   *
   * All the actual state — providers, the active tab's persisted
   * selection, the browsed provider's model list and capability lookups —
   * lives in src/sidepanel/stores/selection.svelte.ts; this component is
   * presentation plus the popover's open/close and keyboard/click-outside
   * handling.
   */
  import {
    selection,
    syncToTab,
    selectProvider,
    selectModel,
    enterManualModel,
    reloadModels,
    refresh,
    openOptionsPage,
    closePicker,
    togglePicker,
    type ModelListEntry,
  } from "../stores/selection.svelte";
  import { panel } from "../stores/panel.svelte";
  import Markdown from "../../lib/components/Markdown.svelte";

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
  let manualModelInput = $state("");
  let rootEl: HTMLDivElement | undefined = $state();

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

  function handleProviderChange(e: Event): void {
    const id = (e.currentTarget as HTMLSelectElement).value;
    selectProvider(id);
  }

  function handlePickModel(entry: ModelListEntry): void {
    if (entry.capability?.status !== "tool-capable") return;
    void selectModel(entry.model.id).then(() => closePicker());
  }

  function handleManualSubmit(e: SubmitEvent): void {
    e.preventDefault();
    void enterManualModel(manualModelInput);
  }

  // ---- Trigger chip label/variant -----------------------------------

  const triggerInfo = $derived.by((): { label: string; variant: "normal" | "muted" | "warning" } => {
    if (selection.providersStatus === "loading") return { label: "Loading providers…", variant: "muted" };
    if (selection.providers.length === 0) return { label: "No provider — set up in options", variant: "warning" };
    const r = selection.resolution;
    if (r.status === "dangling") return { label: "Provider removed — choose one", variant: "warning" };
    if (r.status === "none") return { label: "Choose provider & model", variant: "muted" };
    // Card 35: still needs a one-click confirmation before it can send —
    // flag that on the trigger chip too, not just in the composer.
    if (selection.needsConfirmation) {
      return { label: `Confirm ${r.config.name} · ${r.model}`, variant: "warning" };
    }
    return { label: `${r.config.name} · ${r.model}`, variant: "normal" };
  });

  function capabilityBadge(status: "tool-capable" | "no-tools" | "unknown"): { icon: string; label: string } {
    switch (status) {
      case "no-tools":
        return { icon: "⊘", label: "No tools" };
      case "unknown":
        return { icon: "?", label: "Unverified" };
      case "tool-capable":
        return { icon: "✓", label: "Tool-capable" };
    }
  }

  function reasonFor(entry: ModelListEntry): string | undefined {
    if (!entry.capability) return undefined;
    if (entry.capability.status === "unknown") {
      return entry.capability.detail?.join(" ") ?? "Tool support not verified for this model.";
    }
    if (entry.capability.status === "no-tools") {
      return entry.capability.detail?.join(" ") ?? "This model doesn't support tool calling.";
    }
    return entry.capability.detail?.join(" ");
  }

  const hasToolCapableEntry = $derived(
    selection.modelsState.status === "loaded" &&
      selection.modelsState.entries.some((e) => e.capability?.status === "tool-capable"),
  );

  const isOllama = $derived(selection.browsingProvider?.type === "ollama");

  /** A current tool-calling-capable Ollama model, named concretely per card 14 rather than leaving "pull a model" vague. */
  const OLLAMA_TOOL_MODEL_SUGGESTION = "llama3.1";
</script>

<div class="picker" bind:this={rootEl}>
  <button
    type="button"
    class="picker__trigger"
    data-variant={triggerInfo.variant}
    aria-haspopup="dialog"
    aria-expanded={selection.pickerOpen}
    onclick={togglePicker}
    title={triggerInfo.label}
  >
    {triggerInfo.label}
  </button>

  {#if selection.pickerOpen}
    <div class="picker__panel" role="dialog" aria-label="Choose provider and model">
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

        <label class="field">
          <span class="field__label">Provider</span>
          <select value={selection.browsingProviderId} onchange={handleProviderChange}>
            {#each selection.providers as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </label>

        <div class="field__label">Model</div>

        {#if selection.modelsState.status === "loading"}
          <p class="hint">Checking models…</p>
        {:else if selection.modelsState.status === "error"}
          <p class="banner banner--error">{selection.modelsState.message}</p>
          {#if selection.modelsState.error.kind === "unreachable-or-cors" && selection.modelsState.error.fix}
            {@const fix = selection.modelsState.error.fix}
            <p class="hint">{fix.label}:</p>
            <Markdown source={fenceOf(fix.command)} />
          {:else if selection.modelsState.error.kind === "auth"}
            <button type="button" onclick={openOptionsPage}>Open options to check the API key</button>
          {/if}
          <button type="button" onclick={reloadModels}>Retry</button>
        {:else if selection.modelsState.status === "not-supported"}
          <p class="hint">{selection.modelsState.message}</p>
          <form class="manual-entry" onsubmit={handleManualSubmit}>
            <input
              type="text"
              placeholder="Model id, e.g. gpt-4o-mini"
              bind:value={manualModelInput}
            />
            <button type="submit">Check</button>
          </form>
          {#if selection.modelsState.manualEntry}
            {@const entry = selection.modelsState.manualEntry}
            {@const badge = entry.capability ? capabilityBadge(entry.capability.status) : undefined}
            <ul class="model-list">
              <li>
                <button
                  type="button"
                  class="model-row"
                  data-status={entry.capability?.status ?? "unknown"}
                  disabled={entry.capability?.status !== "tool-capable"}
                  onclick={() => handlePickModel(entry)}
                >
                  <span class="model-row__name">{entry.model.name}</span>
                  {#if badge}
                    <span class="model-row__badge">{badge.icon} {badge.label}</span>
                  {/if}
                </button>
                {#if reasonFor(entry)}
                  <p class="model-row__reason">{reasonFor(entry)}</p>
                {/if}
              </li>
            </ul>
          {/if}
        {:else if selection.modelsState.status === "loaded"}
          {#if selection.modelsState.entries.length === 0}
            <p class="hint">
              This provider has no models installed yet.
              {#if isOllama}
                Pull one to get started, e.g. <code>ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code>.
              {/if}
            </p>
            {#if isOllama}
              <Markdown source={fenceOf(`ollama pull ${OLLAMA_TOOL_MODEL_SUGGESTION}`)} />
            {/if}
            <button type="button" onclick={reloadModels}>Retry</button>
          {:else}
            <ul class="model-list">
              {#each selection.modelsState.entries as entry (entry.model.id)}
                {@const badge = entry.capability ? capabilityBadge(entry.capability.status) : undefined}
                {@const isActive =
                  selection.resolution.status === "ok" &&
                  selection.resolution.config.id === selection.browsingProviderId &&
                  selection.resolution.model === entry.model.id}
                <li>
                  <button
                    type="button"
                    class="model-row"
                    data-status={entry.capability?.status ?? "loading"}
                    data-active={isActive}
                    disabled={entry.capability?.status !== "tool-capable"}
                    onclick={() => handlePickModel(entry)}
                  >
                    <span class="model-row__name">{entry.model.name}</span>
                    {#if badge}
                      <span class="model-row__badge">{badge.icon} {badge.label}</span>
                    {:else}
                      <span class="model-row__badge">…</span>
                    {/if}
                  </button>
                  {#if reasonFor(entry)}
                    <p class="model-row__reason">{reasonFor(entry)}</p>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if !hasToolCapableEntry}
              <p class="banner banner--warning">
                No tool-capable models on this provider yet.
                {#if isOllama}
                  Pull one to get started, e.g. <code>ollama pull {OLLAMA_TOOL_MODEL_SUGGESTION}</code>, then retry.
                {:else}
                  Check the provider's model list for one that supports tool/function calling.
                {/if}
              </p>
              {#if isOllama}
                <Markdown source={fenceOf(`ollama pull ${OLLAMA_TOOL_MODEL_SUGGESTION}`)} />
              {/if}
              <button type="button" onclick={reloadModels}>Retry</button>
            {/if}
          {/if}
        {/if}

        <div class="picker__footer">
          <button type="button" class="link-btn" onclick={refresh}>Refresh</button>
          <button type="button" class="link-btn" onclick={openOptionsPage}>Manage providers</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .picker {
    position: relative;
    min-width: 0;
  }

  .picker__trigger {
    /* Clamp to whichever is smaller: the usual 160px cap, or whatever
       width the header's flex row actually shrank `.picker` down to (e.g.
       once card 36's "New chat" button is sharing the row) — `.picker`
       itself already shrinks correctly (min-width: 0 below), but a plain
       <button> doesn't inherit a flex item's shrunk width on its own, so
       without this it kept sizing up to the flat 160px and overflowing
       past its now-narrower parent instead of ellipsizing within it. */
    max-width: min(160px, 100%);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-small);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker__trigger[data-variant="muted"] {
    color: var(--color-on-surface-variant);
  }

  .picker__trigger[data-variant="warning"] {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .picker__panel {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: 10;
    width: 260px;
    max-width: calc(100vw - var(--space-4));
    max-height: 60vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--color-surface);
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-card);
    padding: var(--space-3);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field__label {
    font-size: var(--font-size-small);
    font-weight: 600;
    color: var(--color-on-surface-variant);
  }

  .field select {
    width: 100%;
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

  .banner code {
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
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-container);
    border: 1px solid transparent;
    min-width: 0;
  }

  .model-row[data-active="true"] {
    border-color: var(--color-primary);
  }

  .model-row[data-status="no-tools"],
  .model-row[data-status="unknown"] {
    background: transparent;
  }

  .model-row__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 auto;
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

  .model-row__reason {
    margin: 2px 0 0 var(--space-2);
    font-size: var(--font-size-small);
    color: var(--color-on-surface-variant);
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
    padding-top: var(--space-2);
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
