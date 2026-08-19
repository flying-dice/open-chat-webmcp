<script lang="ts">
  // "Choose a backend" step of the add-provider flow (card 50,
  // decisions/21-provider-presets.md). Purely presentational: picking a
  // tile hands the chosen `ProviderPreset` (or `undefined` for "Custom
  // (OpenAI-compatible)") back to the parent, which then mounts
  // ProviderForm.svelte pre-filled from it — this component never touches
  // chrome.storage or builds a provider itself.
  import { PROVIDER_PRESETS, type ProviderPreset } from "../../lib/providers/presets";

  interface Props {
    /** `undefined` means "Custom (OpenAI-compatible)" was chosen — today's blank-form flow, unchanged. */
    onChoose: (preset: ProviderPreset | undefined) => void;
    onCancel: () => void;
  }
  let { onChoose, onCancel }: Props = $props();

  const localPresets = PROVIDER_PRESETS.filter((p) => p.local);
  const hostedPresets = PROVIDER_PRESETS.filter((p) => !p.local);
</script>

<div class="form preset-picker">
  <p class="note">
    Pick the backend you want to connect, then fill in what it actually needs — usually just an
    API key. Every field is still editable afterwards, so this is just a starting point.
  </p>

  <div class="preset-picker__group">
    <h3 class="preset-picker__group-title">Local</h3>
    <div class="preset-grid">
      {#each localPresets as preset (preset.id)}
        <button type="button" class="preset-tile" onclick={() => onChoose(preset)}>
          <span class="preset-tile__label">{preset.label}</span>
          <span class="preset-tile__meta">No API key</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="preset-picker__group">
    <h3 class="preset-picker__group-title">Hosted</h3>
    <div class="preset-grid">
      {#each hostedPresets as preset (preset.id)}
        <button type="button" class="preset-tile" onclick={() => onChoose(preset)}>
          <span class="preset-tile__label">{preset.label}</span>
          <span class="preset-tile__meta">API key required</span>
        </button>
      {/each}
      <button type="button" class="preset-tile preset-tile--custom" onclick={() => onChoose(undefined)}>
        <span class="preset-tile__label">Custom (OpenAI-compatible)</span>
        <span class="preset-tile__meta">Any other OpenAI-compatible endpoint</span>
      </button>
    </div>
  </div>

  <div class="form__actions">
    <button type="button" class="btn-plain" onclick={onCancel}>Cancel</button>
  </div>
</div>
