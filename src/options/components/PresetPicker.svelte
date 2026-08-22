<script lang="ts">
  // "Choose a backend" step of the add-provider flow (card 50,
  // decisions/21-provider-presets.md). Purely presentational: picking a
  // tile hands the chosen `ProviderPreset` (or `undefined` for "Custom
  // (OpenAI-compatible)") back to the parent, which then mounts
  // ProviderForm.svelte pre-filled from it — this component never touches
  // chrome.storage or builds a provider itself.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): options.css's
  // `.preset-grid`/`.preset-tile` are now Tailwind utilities on plain
  // buttons styled like small cards. Deliberately NOT `Card.Root` wrapping a
  // button — the whole tile is the click target, and a button is the only
  // element that gives that keyboard and screen-reader semantics for free.
  //
  // `PROVIDER_PRESETS` entries also carry an `icon`, which since card 73 is
  // an opaque KEY the UI resolves (src/ui/providerIcon.ts) rather than an
  // `IconName` the catalogue imported from src/ui/icons.ts. This picker has
  // never rendered it and still doesn't, so that change was invisible here.
  import { PROVIDER_PRESETS, type ProviderPreset } from "../../domain/providers";
  import { m } from "../../paraglide/messages.js";
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";

  interface Props {
    /** `undefined` means "Custom (OpenAI-compatible)" was chosen — today's blank-form flow, unchanged. */
    onChoose: (preset: ProviderPreset | undefined) => void;
    onCancel: () => void;
  }
  let { onChoose, onCancel }: Props = $props();

  const localPresets = PROVIDER_PRESETS.filter((p) => p.local);
  const hostedPresets = PROVIDER_PRESETS.filter((p) => !p.local);

  /** One tile's look — the old `.preset-tile`, as utilities. Shared by the preset tiles and the dashed "Custom" tile so the two can never drift apart. */
  const TILE =
    "flex flex-col items-start gap-0.5 rounded-2xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
</script>

<div class="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4">
  <Alert.Root class="bg-background">
    <Alert.Description>
      {m.presetPicker_description()}
    </Alert.Description>
  </Alert.Root>

  <div class="flex flex-col gap-2">
    <h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {m.presetPicker_localHeading()}
    </h3>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
      {#each localPresets as preset (preset.id)}
        <button type="button" class={TILE} onclick={() => onChoose(preset)}>
          <span class="text-sm font-medium">{preset.label}</span>
          <span class="text-xs text-muted-foreground">{m.presetPicker_noApiKeyLabel()}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {m.presetPicker_hostedHeading()}
    </h3>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
      {#each hostedPresets as preset (preset.id)}
        <button type="button" class={TILE} onclick={() => onChoose(preset)}>
          <span class="text-sm font-medium">{preset.label}</span>
          <span class="text-xs text-muted-foreground">{m.presetPicker_apiKeyRequiredLabel()}</span>
        </button>
      {/each}
      <button
        type="button"
        class="{TILE} border-dashed bg-transparent"
        onclick={() => onChoose(undefined)}
      >
        <span class="text-sm font-medium">{m.presetPicker_customLabel()}</span>
        <span class="text-xs text-muted-foreground">{m.presetPicker_customDescription()}</span>
      </button>
    </div>
  </div>

  <div class="flex items-center gap-2">
    <Button variant="ghost" onclick={onCancel}>{m.cancelAction()}</Button>
  </div>
</div>
