<script lang="ts">
  // One row in the provider list (card 22). Purely presentational — all
  // storage mutation and the permission/test-connection flow live in the
  // parent (ProvidersSection.svelte), passed in as callbacks, so this
  // component never touches chrome.storage or chrome.permissions directly.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): options.css's
  // `.provider-row`/`.badge`/`.icon-btn` are now shadcn `Badge`/`Button` plus
  // Tailwind utilities. The row is a bordered div rather than a `Card`
  // because it nests inside the section's own card and a card-in-card reads
  // as two elevations for one thing. Every control keeps its original
  // accessible name (the verify harness locates them by name —
  // decisions/28's consequences).
  import { untrack } from "svelte";
  import type { ProviderConfig } from "../../domain/providers";
  import { getPreset, type ProviderModel } from "../../domain/providers";
  import type { TestOutcome } from "../lib/testConnection";
  import { providerTestResultClass, providerTestResultMessage } from "../lib/testResultDisplay";
  import Markdown from "../../ui/components/Markdown.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";

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
     * src/domain/providers/capability.ts — the same list the side panel's
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

  /** The chosen model's display name for the `Select` trigger — shadcn's trigger renders whatever we put in it, unlike the native `<select>` this replaced, which showed the selected `<option>`'s text itself. */
  let selectedModelLabel = $derived(
    defaultModelOptions.find((m) => m.id === selectedModelId)?.name ?? "Select a model",
  );

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

<div class="flex flex-col gap-2 rounded-2xl border p-3">
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-col gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        onclick={onMoveUp}
        disabled={isFirst}
        aria-label={`Move ${provider.name} up`}
      >
        <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onclick={onMoveDown}
        disabled={isLast}
        aria-label={`Move ${provider.name} down`}
      >
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
      </Button>
    </div>

    <div class="min-w-0">
      <div class="font-semibold">{provider.name}</div>
      <div class="text-xs break-all text-muted-foreground">{provider.baseUrl}</div>
    </div>

    <Badge variant="outline">{backendLabel}</Badge>
    {#if isDefault}
      {#if defaultInvalidReason}
        <Badge variant="destructive" title={defaultInvalidReason}>Default — needs attention</Badge>
      {:else}
        <Badge>Default</Badge>
      {/if}
    {/if}
    {#if provider.headers && provider.headers.length > 0}
      <span
        class="text-xs text-muted-foreground"
        title="Header values are masked here — open Edit to view or change them."
      >
        {provider.headers.length} custom header{provider.headers.length === 1 ? "" : "s"}
      </span>
    {/if}
    {#if permissionGranted === false}
      <Badge
        variant="destructive"
        title="This extension hasn't been granted permission to contact this host — it will never connect until you grant it."
      >
        Permission needed
      </Badge>
    {:else if permissionGranted === true}
      <Badge variant="outline" title="This extension can contact this host.">Permission granted</Badge>
    {/if}

    <div class="ml-auto flex flex-wrap items-center gap-1">
      <Button variant="outline" size="sm" onclick={onTest} disabled={testing}>
        {testing ? "Testing…" : "Test connection"}
      </Button>
      {#if !isDefault}
        {#if defaultModelsLoading}
          <Button variant="outline" size="sm" disabled>Checking…</Button>
        {:else if defaultModelOptions.length > 0}
          <Select.Root type="single" bind:value={selectedModelId}>
            <Select.Trigger size="sm" aria-label={`Default model for ${provider.name}`}>
              {selectedModelLabel}
            </Select.Trigger>
            <Select.Content>
              {#each defaultModelOptions as model (model.id)}
                <Select.Item value={model.id} label={model.name} />
              {/each}
            </Select.Content>
          </Select.Root>
          <Button variant="outline" size="sm" onclick={() => onSetDefault(selectedModelId)}>
            Set as default
          </Button>
        {/if}
      {/if}
      <Button variant="outline" size="sm" onclick={onEdit}>Edit</Button>
      <Button variant="outline" size="sm" onclick={onRemove}>Remove</Button>
    </div>
  </div>

  {#if !isDefault && !defaultModelsLoading && defaultModelOptions.length === 0 && defaultModelBlockedReason}
    <!-- Card 41/52: same treatment ProviderPicker.svelte gives a disabled
         model row's reason — muted, explanatory text, not an alarm. -->
    <p class="text-xs text-muted-foreground">{defaultModelBlockedReason}</p>
  {/if}

  {#if testOutcome}
    <p class={providerTestResultClass(testOutcome)}>{providerTestResultMessage(testOutcome)}</p>
    {#if testOutcome.kind === "unreachable" && testOutcome.fix}
      {@const fix = testOutcome.fix}
      <Alert.Root class="bg-muted/40">
        <Alert.Description>{fix.label}:</Alert.Description>
      </Alert.Root>
      <Markdown source={fenceOf(fix.command)} />
    {/if}
  {/if}
</div>
