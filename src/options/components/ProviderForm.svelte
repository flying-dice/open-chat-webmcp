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
  // `apiKey` and `headers` when empty, which registry.ts's `updateProvider`
  // treats as "clear it" (`"apiKey"`/`"headers" in patch`). That keeps this
  // form's mental model simple: what you see in the fields is what gets
  // saved, full stop.
  //
  // Custom headers (decisions/15-custom-headers-are-credentials.md) are
  // offered for every provider type, not just OpenAI-compatible ones — a
  // local Ollama server can sit behind a gateway too, and needs the same
  // shape. Header VALUES get the exact same treatment as `apiKey`: masked
  // by default, stored local-only (registry.ts), never synced. The editor
  // itself is HeadersEditor.svelte, shared with McpServerForm.svelte since
  // card 81; this form supplies only its own reserved-name rule and copy.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): options.css's
  // `.form`/`.field`/`.api-key-field` became shadcn `Field` + `Input` +
  // `InputGroup`. The masked-by-default API key and header values, and the
  // Show/Hide toggles that reveal them, behave exactly as before — the
  // toggle just lives in an `InputGroup` addon instead of a sibling button.
  import { untrack } from "svelte";
  import type { ProviderConfig } from "../../domain/providers";
  import {
    getPreset,
    reservedHeaderReason,
    type ProviderPreset,
    type ProviderType,
  } from "../../domain/providers";
  import { DEFAULT_OPENAI_BASE_URL } from "../../domain/providers";
  import { originPatternForUrl } from "../../domain/permissions";
  import {
    firstHeaderError,
    toHeaderRows,
    type HeaderRow,
    type ReservedHeaderCheck,
  } from "../forms/headerRows";
  import {
    PERMISSION_DENIED_MESSAGE,
    requestHostPermission,
    trackHostPermission,
  } from "../forms/hostPermission.svelte";
  import { testProviderConnection, type TestOutcome } from "../forms/testConnection";
  import { providerTestResultClass, providerTestResultMessage } from "../forms/testResultDisplay";
  import HeadersEditor from "./HeadersEditor.svelte";
  import Markdown from "../../ui/components/Markdown.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import * as Field from "$lib/components/ui/field";
  import * as InputGroup from "$lib/components/ui/input-group";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";

  /**
   * Wrap a copy-pasteable command as a fenced code block so it renders
   * through Markdown.svelte's existing code-block pipeline (src/ui/markdown.ts's
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
    /**
     * The backend chosen in the "add" flow's picker step (card 50,
     * decisions/21-provider-presets.md) — `undefined` means either "Custom
     * (OpenAI-compatible)" was chosen, or (in "edit" mode) this prop simply
     * isn't passed; edit mode instead re-derives the preset this provider
     * was originally added from via `initial.presetId` (see `activePreset`
     * below), since re-editing shouldn't require the caller to look that up
     * itself.
     */
    preset?: ProviderPreset;
    /** "add" mode only: lets the user back out to the picker and choose a different backend without cancelling the whole flow. */
    onChangeBackend?: () => void;
    onSubmit: (data: Omit<ProviderConfig, "id">) => Promise<void>;
    onCancel: () => void;
  }

  let { mode, initial, preset, onChangeBackend, onSubmit, onCancel }: Props = $props();

  /**
   * The preset this form is currently acting on, from whichever mode
   * supplied it — the `preset` prop in "add" mode, or a lookup from the
   * saved `presetId` in "edit" mode (`getPreset` returns `undefined` for a
   * missing/unrecognised id exactly like "no preset was ever set", per
   * decisions/21: absence is a valid state, never an error). Drives the
   * backend banner, whether the API key field is shown by default, and the
   * "get a key" / setup link — never anything that would make a filled-in
   * field un-editable.
   */
  let activePreset = $derived(mode === "add" ? preset : getPreset(initial?.presetId));

  const PROVIDER_TYPES: {
    value: ProviderType;
    label: string;
    needsApiKey: boolean;
    defaultBaseUrl: string;
  }[] = [
    {
      value: "ollama",
      label: "Ollama",
      needsApiKey: false,
      defaultBaseUrl: "http://localhost:11434",
    },
    {
      value: "openai",
      label: "OpenAI-compatible",
      needsApiKey: true,
      defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    },
  ];

  // `initial` (when present) only ever seeds this form's editable state
  // once, at mount — the form is deliberately "uncontrolled" after that, so
  // every read below is wrapped in `untrack` to tell svelte-check this is
  // an intentional one-time snapshot, not a missed reactive dependency.
  let name = $state(untrack(() => initial?.name ?? preset?.label ?? ""));
  let type = $state<ProviderType>(untrack(() => initial?.type ?? preset?.type ?? "ollama"));
  let baseUrl = $state(
    untrack(() => initial?.baseUrl ?? preset?.baseUrl ?? PROVIDER_TYPES[0].defaultBaseUrl),
  );
  let apiKey = $state(untrack(() => initial?.apiKey ?? ""));
  let showApiKey = $state(false);

  /** Custom request headers (decisions/15-custom-headers-are-credentials.md), in the editor's row shape — see ../forms/headerRows.ts for why a row carries a synthetic id. */
  let headers = $state<HeaderRow[]>(
    untrack(() => toHeaderRows((initial?.headers ?? []).map((h) => [h.key, h.value] as const))),
  );

  /**
   * This form's reserved-name rule, handed to the shared editor and to
   * `firstHeaderError`. Reads `type` and `apiKey` reactively, so switching
   * provider type or clearing the API key re-evaluates every row's check
   * live.
   */
  const isReservedHeader: ReservedHeaderCheck = (key) =>
    reservedHeaderReason(key, { type, apiKeyConfigured: apiKey.trim().length > 0 });

  let saving = $state(false);
  let formError = $state<string | undefined>(undefined);

  let typeInfo = $derived(PROVIDER_TYPES.find((t) => t.value === type) ?? PROVIDER_TYPES[0]);

  /**
   * Whether to show the API key field at all — hidden by default for a
   * "local" preset (decisions/21: local runtimes need no key) UNLESS a key
   * is already present (edit mode on a local backend someone put behind an
   * authenticated gateway) or there simply is no active preset (Custom, or
   * an existing provider with no `presetId`), in which case this falls back
   * to today's type-only rule. Never hides a field that already has a
   * value — hiding is a default-visibility choice, not a way to make a
   * filled-in field un-editable.
   */
  let forceShowApiKeyField = $state(false);
  let showApiKeyField = $derived(
    typeInfo.needsApiKey &&
      (!activePreset?.local || apiKey.trim().length > 0 || forceShowApiKeyField),
  );

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
  const hostPermission = trackHostPermission(() => baseUrl);

  let testing = $state(false);
  let testOutcome = $state<TestOutcome | undefined>(undefined);

  // TODO: clean-code - 0.15 - NAMING: buildData is a generic name for a well-typed, single-purpose builder — should convey it builds a provider config (cf. McpServerForm.svelte's identically-named buildData).
  function buildData(): Omit<ProviderConfig, "id"> {
    // Drop only fully-blank rows (an added-but-not-yet-filled-in row) —
    // anything else is sent as typed, including an invalid one; callers
    // (handleTest/handleSubmit) check `firstHeaderError()` first and never
    // reach here with one, since a reserved or duplicate name must be fixed
    // or removed before the row's own validation lets it through.
    const cleanHeaders = headers
      .filter((h) => h.key.trim().length > 0 || h.value.trim().length > 0)
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }));

    return {
      type,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      headers: cleanHeaders.length > 0 ? cleanHeaders : undefined,
      // "add" mode: whichever preset the picker step chose (undefined for
      // Custom). "edit" mode: always resubmitted unchanged — which preset a
      // provider was originally added from doesn't change just because its
      // fields did (decisions/21: a preset is a starting point, and editing
      // away from its defaults doesn't retroactively make it "not that
      // preset" for labelling purposes).
      presetId: mode === "add" ? preset?.id : initial?.presetId,
    };
  }

  /**
   * "Test connection" — `requestHostPermission` is the first `await` here on
   * purpose (decisions/09): the browser only honours the request while still
   * inside the user gesture that triggered it, so no other async work may run
   * ahead of it.
   */
  async function handleTest(): Promise<void> {
    testOutcome = undefined;
    const draft = buildData();
    if (!originPatternForUrl(draft.baseUrl)) {
      testOutcome = {
        kind: "invalid-response",
        message: "Enter a valid http:// or https:// base URL first.",
      };
      return;
    }
    const headerError = firstHeaderError(headers, isReservedHeader);
    if (headerError) {
      testOutcome = { kind: "invalid-response", message: headerError };
      return;
    }
    testing = true;
    try {
      if (!(await requestHostPermission(draft.baseUrl, hostPermission))) {
        testOutcome = { kind: "permission-denied", message: PERMISSION_DENIED_MESSAGE };
        return;
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
    const headerError = firstHeaderError(headers, isReservedHeader);
    if (headerError) {
      formError = headerError;
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

  /** The provider-type dropdown's trigger text — shadcn's `Select` renders whatever we put in the trigger, unlike the native `<select>` this replaced. */
  let typeLabel = $derived(typeInfo.label);
</script>

<form class="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4" onsubmit={handleSubmit}>
  {#if mode === "add" && preset}
    <div class="flex items-center gap-2">
      <Badge>{preset.label}</Badge>
      {#if onChangeBackend}
        <Button variant="ghost" size="sm" onclick={onChangeBackend}>Change backend</Button>
      {/if}
    </div>
  {/if}

  {#if activePreset?.note}
    <Alert.Root class="bg-background">
      <Alert.Description>{activePreset.note}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="flex flex-wrap gap-4">
    <Field.Field class="flex-1 basis-50">
      <Field.Label for="pf-name">Display name</Field.Label>
      <Input id="pf-name" type="text" bind:value={name} placeholder="e.g. Local Ollama" required class="text-sm" />
    </Field.Field>
    <Field.Field class="flex-1 basis-50">
      <Field.Label for="pf-type">Provider type</Field.Label>
      <!-- Controlled rather than `bind:value`: `type` is a `ProviderType`, not
           a plain string, and the `$effect` above reacts to it changing — so
           the cast happens here, at the one place a new value arrives. -->
      <Select.Root
        type="single"
        value={type}
        onValueChange={(next) => (type = next as ProviderType)}
      >
        <Select.Trigger id="pf-type" class="w-full">{typeLabel}</Select.Trigger>
        <Select.Content>
          {#each PROVIDER_TYPES as t (t.value)}
            <Select.Item value={t.value} label={t.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
  </div>

  <Field.Field>
    <Field.Label for="pf-url">Base URL</Field.Label>
    <Input
      id="pf-url"
      type="text"
      bind:value={baseUrl}
      placeholder={typeInfo.defaultBaseUrl}
      required
      class="text-sm"
    />
    {#if hostPermission.granted === false}
      <Badge variant="destructive" class="w-fit!">Permission needed for this host</Badge>
    {:else if hostPermission.granted === true}
      <Badge variant="outline" class="w-fit!">Permission granted</Badge>
    {/if}
  </Field.Field>

  {#if showApiKeyField}
    <Field.Field>
      <Field.Label for="pf-key">
        API key{activePreset && !activePreset.requiresKey ? "" : " (optional)"}
      </Field.Label>
      <InputGroup.Root>
        <InputGroup.Input
          id="pf-key"
          type={showApiKey ? "text" : "password"}
          bind:value={apiKey}
          placeholder="sk-…"
          autocomplete="off"
          class="text-sm"
        />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button onclick={() => (showApiKey = !showApiKey)}>
            {showApiKey ? "Hide" : "Show"}
          </InputGroup.Button>
        </InputGroup.Addon>
      </InputGroup.Root>
      {#if activePreset?.docsUrl && activePreset.requiresKey}
        <Field.Description>
          Get an API key from <a href={activePreset.docsUrl} target="_blank" rel="noreferrer"
            >{activePreset.label}</a
          >.
        </Field.Description>
      {/if}
    </Field.Field>
  {:else if typeInfo.needsApiKey && activePreset?.local}
    <p class="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {activePreset.label} doesn't need an API key by default.
      <Button variant="ghost" size="sm" onclick={() => (forceShowApiKeyField = true)}>
        Add one anyway
      </Button>
    </p>
  {/if}

  {#snippet headersDescription()}
    Sent on every request to this provider — for a gateway that wants its own <code
      class="font-mono text-xs">x-api-key</code
    >, a tenant or project header, a proxy <code class="font-mono text-xs">Authorization</code>, or a
    Cloudflare Access service-token pair. A bearer token from the API key field above isn't enough
    for those.
  {/snippet}

  <HeadersEditor
    bind:rows={headers}
    isReserved={isReservedHeader}
    firstInputId="pf-header-0-key"
    description={headersDescription}
  />

  <Alert.Root class="bg-background">
    <Alert.Description>
      API keys and custom header values are stored unencrypted on this device
      (chrome.storage.local) and never synced to your Google account. Anyone with access to this
      browser profile can read them.
    </Alert.Description>
  </Alert.Root>

  {#if formError}
    <Field.Error>{formError}</Field.Error>
  {/if}

  {#if testOutcome}
    <p class={providerTestResultClass(testOutcome)}>{providerTestResultMessage(testOutcome)}</p>
    {#if testOutcome.kind === "unreachable" && testOutcome.fix}
      {@const fix = testOutcome.fix}
      <Alert.Root class="bg-background">
        <Alert.Description>{fix.label}:</Alert.Description>
      </Alert.Root>
      <Markdown source={fenceOf(fix.command)} />
    {/if}
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <Button type="submit" disabled={saving}>
      {saving ? "Saving…" : mode === "add" ? "Add provider" : "Save changes"}
    </Button>
    <Button variant="outline" onclick={handleTest} disabled={testing}>
      {testing ? "Testing…" : "Test connection"}
    </Button>
    <Button variant="ghost" onclick={onCancel}>Cancel</Button>
  </div>
</form>
