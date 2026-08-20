<script lang="ts">
  // One row in the provider list (card 22). Purely presentational — all
  // storage mutation and the permission/test-connection flow live in the
  // parent (ProvidersSection.svelte), passed in as callbacks, so this
  // component never touches chrome.storage or chrome.permissions directly.
  import { untrack } from "svelte";
  import type { ProviderConfig } from "../../lib/providers/registry";
  import { getPreset } from "../../lib/providers/presets";
  import type { ProviderModel } from "../../lib/provider";
  import type { TestOutcome } from "../lib/testConnection";
  import { testResultClass, testResultMessage } from "../lib/testResultDisplay";
  import Markdown from "../../lib/components/Markdown.svelte";

  /** See ProviderForm.svelte's identical helper for why this reuses Markdown.svelte's code-block/copy-button pipeline instead of a second one (card 14, card 33). */
  function fenceOf(command: string): string {
    return "```\n" + command + "\n```";
  }

  interface Props {
    provider: ProviderConfig;
    isDefault: boolean;
    isFirst: boolean;
    isLast: boolean;
    /** `undefined` while the grant check is still in flight, distinct from a settled `true`/`false`. */
    permissionGranted: boolean | undefined;
    testOutcome: TestOutcome | undefined;
    testing: boolean;
    /**
     * Card 52 (decisions/23-default-model-from-known-list-not-free-text.md):
     * whether this provider's tool-capable model list is still loading —
     * "Set as default" reads "Checking…" and stays disabled meanwhile,
     * rather than flashing a dropdown/reason before the answer is in.
     */
    defaultModelsLoading: boolean;
    /**
     * This provider's tool-capable models (already filtered by the parent,
     * src/options/components/ProvidersSection.svelte, via the shared
     * src/lib/providers/capability.ts — the same list the side panel's
     * picker would offer). Empty means blocked; see
     * `defaultModelBlockedReason` for why.
     */
    defaultModelOptions: ProviderModel[];
    /** The inline reason "Set as default" is blocked, in the picker's own wording — `undefined` once at least one tool-capable model is available (or while still loading). */
    defaultModelBlockedReason: string | undefined;
    /** Set only when `isDefault` and the STORED default no longer checks out (model removed, re-pulled without tools, provider deleted) — card 41's fourth checklist item: an already-stored invalid default must surface clearly, not silently. */
    defaultInvalidReason: string | undefined;
    onEdit: () => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    /** Card 52: the row picks which of `defaultModelOptions` to set, via its own local `selectedModelId` below. */
    onSetDefault: (modelId: string) => void;
    onTest: () => void;
  }

  let {
    provider,
    isDefault,
    isFirst,
    isLast,
    permissionGranted,
    testOutcome,
    testing,
    defaultModelsLoading,
    defaultModelOptions,
    defaultModelBlockedReason,
    defaultInvalidReason,
    onEdit,
    onRemove,
    onMoveUp,
    onMoveDown,
    onSetDefault,
    onTest,
  }: Props = $props();

  /**
   * Card 52: the model currently chosen in this row's dropdown — defaults to
   * the first tool-capable model, and resets whenever `defaultModelOptions`
   * changes out from under it (a reload landing, or the selected model no
   * longer being in the list) so the dropdown never holds a stale/invalid
   * id. A provider (identity) change already gets a fresh instance of this
   * component for free — `{#each ... (provider.id)}` in ProvidersSection.svelte
   * keys on it, so Svelte remounts rather than reusing this state.
   */
  let selectedModelId = $state(untrack(() => defaultModelOptions[0]?.id ?? ""));
  $effect(() => {
    if (!defaultModelOptions.some((m) => m.id === selectedModelId)) {
      selectedModelId = defaultModelOptions[0]?.id ?? "";
    }
  });

  const TYPE_LABELS: Record<ProviderConfig["type"], string> = {
    ollama: "Ollama",
    openai: "OpenAI-compatible",
  };

  /**
   * Card 50 (decisions/21-provider-presets.md): label a provider by the
   * backend it was added from, not just its wire type — "Groq" reads better
   * than "OpenAI-compatible" for a row that came from the Groq preset.
   * Falls back to the type label for a provider with no `presetId` (Custom,
   * or anything stored before this card) or one whose preset id no longer
   * matches the catalog (`getPreset` returns `undefined` for both — a
   * missing preset is treated exactly like "no preset was ever set", never
   * an error).
   */
  let backendLabel = $derived(getPreset(provider.presetId)?.label ?? TYPE_LABELS[provider.type]);
</script>

<div class="provider-row">
  <div class="provider-row__top">
    <div class="provider-row__order">
      <button class="icon-btn" type="button" onclick={onMoveUp} disabled={isFirst} aria-label={`Move ${provider.name} up`}>
        ▲
      </button>
      <button class="icon-btn" type="button" onclick={onMoveDown} disabled={isLast} aria-label={`Move ${provider.name} down`}>
        ▼
      </button>
    </div>

    <div>
      <div class="provider-row__name">{provider.name}</div>
      <div class="provider-row__url">{provider.baseUrl}</div>
    </div>

    <span class="badge">{backendLabel}</span>
    {#if isDefault}
      {#if defaultInvalidReason}
        <span class="badge badge--danger" title={defaultInvalidReason}>Default — needs attention</span>
      {:else}
        <span class="badge badge--primary">Default</span>
      {/if}
    {/if}
    {#if provider.headers && provider.headers.length > 0}
      <span
        class="provider-row__headers"
        title="Header values are masked here — open Edit to view or change them."
      >
        {provider.headers.length} custom header{provider.headers.length === 1 ? "" : "s"}
      </span>
    {/if}
    {#if permissionGranted === false}
      <span
        class="badge badge--danger"
        title="This extension hasn't been granted permission to contact this host — it will never connect until you grant it."
      >
        Permission needed
      </span>
    {:else if permissionGranted === true}
      <span class="badge" title="This extension can contact this host.">Permission granted</span>
    {/if}

    <div class="provider-row__actions">
      <button type="button" onclick={onTest} disabled={testing}>
        {testing ? "Testing…" : "Test connection"}
      </button>
      {#if !isDefault}
        {#if defaultModelsLoading}
          <button type="button" disabled>Checking…</button>
        {:else if defaultModelOptions.length > 0}
          <select bind:value={selectedModelId} aria-label={`Default model for ${provider.name}`}>
            {#each defaultModelOptions as model (model.id)}
              <option value={model.id}>{model.name}</option>
            {/each}
          </select>
          <button type="button" onclick={() => onSetDefault(selectedModelId)}>Set as default</button>
        {/if}
      {/if}
      <button type="button" onclick={onEdit}>Edit</button>
      <button type="button" onclick={onRemove}>Remove</button>
    </div>
  </div>

  {#if !isDefault && !defaultModelsLoading && defaultModelOptions.length === 0 && defaultModelBlockedReason}
    <!-- Card 41/52: same treatment ProviderPicker.svelte gives a disabled
         model row's reason — muted, explanatory text, not an alarm. -->
    <p class="hint">{defaultModelBlockedReason}</p>
  {/if}

  {#if testOutcome}
    <p class={`test-result ${testResultClass(testOutcome)}`}>{testResultMessage(testOutcome)}</p>
    {#if testOutcome.kind === "unreachable" && testOutcome.fix}
      {@const fix = testOutcome.fix}
      <p class="note">{fix.label}:</p>
      <Markdown source={fenceOf(fix.command)} />
    {/if}
  {/if}
</div>
