<script lang="ts">
  // One row in the provider list (card 22). Purely presentational — all
  // storage mutation and the permission/test-connection flow live in the
  // parent (ProvidersSection.svelte), passed in as callbacks, so this
  // component never touches chrome.storage or chrome.permissions directly.
  import type { ProviderConfig } from "../../lib/providers/registry";
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
     * Card 41 (decisions/11-provider-capability-detection.md): whether
     * `provider.defaultModel`'s tool-capability is still being checked —
     * "Set as default" reads "Checking…" and stays disabled meanwhile,
     * rather than flashing enabled before the answer is in.
     */
    checkingDefaultModel: boolean;
    /** Whether `provider.defaultModel` is confirmed tool-capable — the same three-state rule (tool-capable / no-tools / unknown) the side panel's picker applies, computed once in the parent (src/options/components/ProvidersSection.svelte) via the shared src/lib/providers/capability.ts so both surfaces never disagree. */
    canSetDefault: boolean;
    /** The inline reason "Set as default" is disabled, in the picker's own wording — `undefined` once the model checks out (or while still checking). */
    setDefaultBlockedReason: string | undefined;
    /** Set only when `isDefault` and the STORED default no longer checks out (model removed, re-pulled without tools, provider deleted) — card 41's fourth checklist item: an already-stored invalid default must surface clearly, not silently. */
    defaultInvalidReason: string | undefined;
    onEdit: () => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onSetDefault: () => void;
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
    checkingDefaultModel,
    canSetDefault,
    setDefaultBlockedReason,
    defaultInvalidReason,
    onEdit,
    onRemove,
    onMoveUp,
    onMoveDown,
    onSetDefault,
    onTest,
  }: Props = $props();

  const TYPE_LABELS: Record<ProviderConfig["type"], string> = {
    ollama: "Ollama",
    openai: "OpenAI-compatible",
  };
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

    <span class="badge">{TYPE_LABELS[provider.type]}</span>
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
        <button type="button" onclick={onSetDefault} disabled={checkingDefaultModel || !canSetDefault}>
          {checkingDefaultModel ? "Checking…" : "Set as default"}
        </button>
      {/if}
      <button type="button" onclick={onEdit}>Edit</button>
      <button type="button" onclick={onRemove}>Remove</button>
    </div>
  </div>

  {#if !isDefault && !checkingDefaultModel && setDefaultBlockedReason}
    <!-- Card 41: same treatment ProviderPicker.svelte gives a disabled
         model row's reason — muted, explanatory text, not an alarm. -->
    <p class="hint">{setDefaultBlockedReason}</p>
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
