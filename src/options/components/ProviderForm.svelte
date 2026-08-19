<script lang="ts">
  // Add/edit form for one provider config (card 22,
  // decisions/10-provider-registry-and-credential-storage.md). Used for both
  // modes: in "add" mode `initial` is absent and fields start blank/defaulted;
  // in "edit" mode `initial` pre-fills every field, including the actual
  // (unencrypted, decision 10) API key — there is nothing to protect by
  // masking-and-hiding it from the same person who is already looking at
  // this options page.
  //
  // Submitting always sends every field (never a sparse patch) — including
  // `apiKey` when the input is empty, which registry.ts's `updateProvider`
  // treats as "clear the key" (`"apiKey" in patch`). That keeps this form's
  // mental model simple: what you see in the fields is what gets saved,
  // full stop.
  import { untrack } from "svelte";
  import type { ProviderConfig } from "../../lib/providers/registry";
  import type { ProviderType } from "../../lib/provider";
  import { DEFAULT_OPENAI_BASE_URL } from "../../lib/providers/openai";
  import { hasHostPermission, originPatternForUrl, requestHostPermission } from "../lib/permissions";
  import { testProviderConnection, type TestOutcome } from "../lib/testConnection";
  import { testResultClass, testResultMessage } from "../lib/testResultDisplay";
  import Markdown from "../../lib/components/Markdown.svelte";

  /**
   * Wrap a copy-pasteable command as a fenced code block so it renders
   * through Markdown.svelte's existing code-block pipeline (src/lib/markdown.ts's
   * `renderCodeBlock`) — that pipeline already gives every fenced block its
   * own working "Copy"/"Copied" button, so this reuses that exact,
   * already-tested affordance instead of hand-rolling a second one
   * (card 14: "make the fix copyable, not just described"; card 33: same
   * trick, reused here so the options page's fix is copyable too, not just
   * the side panel's).
   */
  function fenceOf(command: string): string {
    return "```\n" + command + "\n```";
  }

  interface Props {
    mode: "add" | "edit";
    initial?: ProviderConfig;
    onSubmit: (data: Omit<ProviderConfig, "id">) => Promise<void>;
    onCancel: () => void;
  }

  let { mode, initial, onSubmit, onCancel }: Props = $props();

  const PROVIDER_TYPES: {
    value: ProviderType;
    label: string;
    needsApiKey: boolean;
    defaultBaseUrl: string;
  }[] = [
    { value: "ollama", label: "Ollama", needsApiKey: false, defaultBaseUrl: "http://localhost:11434" },
    { value: "openai", label: "OpenAI-compatible", needsApiKey: true, defaultBaseUrl: DEFAULT_OPENAI_BASE_URL },
  ];

  // `initial` (when present) only ever seeds this form's editable state
  // once, at mount — the form is deliberately "uncontrolled" after that, so
  // every read below is wrapped in `untrack` to tell svelte-check this is
  // an intentional one-time snapshot, not a missed reactive dependency.
  let name = $state(untrack(() => initial?.name ?? ""));
  let type = $state<ProviderType>(untrack(() => initial?.type ?? "ollama"));
  let baseUrl = $state(untrack(() => initial?.baseUrl ?? PROVIDER_TYPES[0].defaultBaseUrl));
  let apiKey = $state(untrack(() => initial?.apiKey ?? ""));
  let defaultModel = $state(untrack(() => initial?.defaultModel ?? ""));
  let showApiKey = $state(false);

  let saving = $state(false);
  let formError = $state<string | undefined>(undefined);

  let typeInfo = $derived(PROVIDER_TYPES.find((t) => t.value === type) ?? PROVIDER_TYPES[0]);

  // Switching provider type in "add" mode swaps the base-URL placeholder to
  // that type's default only while the field is still untouched — never
  // overwrites a URL the user already typed.
  let previousType = untrack(() => type);
  $effect(() => {
    if (type !== previousType) {
      if (baseUrl.trim() === "" || baseUrl === previousDefaultFor(previousType)) {
        baseUrl = typeInfo.defaultBaseUrl;
      }
      previousType = type;
    }
  });
  function previousDefaultFor(t: ProviderType): string {
    return PROVIDER_TYPES.find((p) => p.value === t)?.defaultBaseUrl ?? "";
  }

  // Live permission-grant state for whatever base URL is currently typed,
  // so "Test connection" can tell the user up front whether it will need to
  // prompt for a host permission (decisions/09's `optional_host_permissions`
  // flow, generalized by this card).
  let permissionGranted = $state<boolean | undefined>(undefined);
  $effect(() => {
    const url = baseUrl.trim();
    permissionGranted = undefined;
    if (!originPatternForUrl(url)) return;
    hasHostPermission(url).then((granted) => {
      permissionGranted = granted;
    });
  });

  let testing = $state(false);
  let testOutcome = $state<TestOutcome | undefined>(undefined);

  function buildData(): Omit<ProviderConfig, "id"> {
    return {
      type,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      defaultModel: defaultModel.trim() ? defaultModel.trim() : undefined,
    };
  }

  /**
   * "Test connection" — MUST call `chrome.permissions.request` as the first
   * `await` in this click-bound handler when permission isn't already known
   * to be granted (decisions/09): the browser only honours the request while
   * still inside the user gesture that triggered it, so no other async work
   * runs ahead of it here.
   */
  async function handleTest(): Promise<void> {
    testOutcome = undefined;
    const draft = buildData();
    if (!originPatternForUrl(draft.baseUrl)) {
      testOutcome = { kind: "invalid-response", message: "Enter a valid http:// or https:// base URL first." };
      return;
    }
    testing = true;
    try {
      if (permissionGranted !== true) {
        const granted = await requestHostPermission(draft.baseUrl);
        permissionGranted = granted;
        if (!granted) {
          testOutcome = {
            kind: "permission-denied",
            message:
              "This extension doesn't have permission to contact this host yet, and the request was declined. Grant it (Chrome will prompt again next time, or grant it from chrome://extensions) before testing.",
          };
          return;
        }
      }
      testOutcome = await testProviderConnection({ id: initial?.id ?? "draft", ...draft });
    } finally {
      testing = false;
    }
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    formError = undefined;

    if (name.trim().length === 0) {
      formError = "Enter a display name.";
      return;
    }
    if (!originPatternForUrl(baseUrl.trim())) {
      formError = "Enter a valid http:// or https:// base URL.";
      return;
    }

    saving = true;
    try {
      await onSubmit(buildData());
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<form class="form" onsubmit={handleSubmit}>
  <div class="field-row">
    <div class="field">
      <label for="pf-name">Display name</label>
      <input id="pf-name" type="text" bind:value={name} placeholder="e.g. Local Ollama" required />
    </div>
    <div class="field">
      <label for="pf-type">Provider type</label>
      <select id="pf-type" bind:value={type}>
        {#each PROVIDER_TYPES as t (t.value)}
          <option value={t.value}>{t.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="field">
    <label for="pf-url">Base URL</label>
    <input
      id="pf-url"
      type="text"
      bind:value={baseUrl}
      placeholder={typeInfo.defaultBaseUrl}
      required
    />
    {#if permissionGranted === false}
      <span class="badge badge--danger">Permission needed for this host</span>
    {:else if permissionGranted === true}
      <span class="badge">Permission granted</span>
    {/if}
  </div>

  {#if typeInfo.needsApiKey}
    <div class="field">
      <label for="pf-key">API key (optional)</label>
      <div class="api-key-field">
        <input
          id="pf-key"
          type={showApiKey ? "text" : "password"}
          bind:value={apiKey}
          placeholder="sk-…"
          autocomplete="off"
        />
        <button type="button" class="btn-plain" onclick={() => (showApiKey = !showApiKey)}>
          {showApiKey ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  {/if}

  <p class="note">
    API keys are stored unencrypted on this device (chrome.storage.local) and never synced to
    your Google account. Anyone with access to this browser profile can read them.
  </p>

  <div class="field">
    <label for="pf-model">Default model (optional)</label>
    <input
      id="pf-model"
      type="text"
      bind:value={defaultModel}
      placeholder="e.g. llama3.1 — used when this provider is set as default"
    />
  </div>

  {#if formError}
    <p class="form__error">{formError}</p>
  {/if}

  {#if testOutcome}
    <p class={`test-result ${testResultClass(testOutcome)}`}>{testResultMessage(testOutcome)}</p>
    {#if testOutcome.kind === "unreachable" && testOutcome.fix}
      {@const fix = testOutcome.fix}
      <p class="note">{fix.label}:</p>
      <Markdown source={fenceOf(fix.command)} />
    {/if}
  {/if}

  <div class="form__actions">
    <button type="submit" class="btn-primary" disabled={saving}>
      {saving ? "Saving…" : mode === "add" ? "Add provider" : "Save changes"}
    </button>
    <button type="button" onclick={handleTest} disabled={testing}>
      {testing ? "Testing…" : "Test connection"}
    </button>
    <button type="button" class="btn-plain" onclick={onCancel}>Cancel</button>
  </div>
</form>
