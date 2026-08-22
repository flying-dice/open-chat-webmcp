<script lang="ts">
  // Add/edit form for one MCP server config (card 39,
  // decisions/14-backend-mcp-servers.md,
  // decisions/15-custom-headers-are-credentials.md). Deliberately mirrors
  // ProviderForm.svelte's shape closely — same "uncontrolled after mount"
  // seeding via `untrack`, same send-every-field-on-submit posture, and (as
  // of card 81) literally the same custom-headers editor and host-permission
  // helpers — because this is exactly the same kind of
  // add/edit-a-remote-endpoint-with-optional-auth-and-headers form the
  // provider registry already established. The one real difference: headers
  // here are a `Record<string, string>` (src/domain/tools's
  // `McpServerConfig.headers`), not an array of `{key, value}` — so this form
  // converts to and from the editor's rows at the load/submit boundary.
  //
  // Reserved-header validation reuses `validateServerHeaders`
  // (src/domain/tools) — the MCP-specific version of ProviderForm.svelte's
  // `reservedHeaderReason` (src/domain/providers/provider.ts) — rather than
  // re-deriving the same rule a third time; each form hands its own rule to
  // the shared editor, since which headers are reserved is the one thing the
  // two registries genuinely disagree about. Both rules render through the
  // same localized copy now (src/ui/reservedHeaderMessage.ts, card 107).
  import { untrack } from "svelte";
  import {
    validateServerHeaders,
    type McpServerAuth,
    type McpServerConfig,
    type McpTransportPreference,
  } from "../../domain/tools";
  // Card 78 moved the sign-in ORCHESTRATION out — three host-permission
  // requests, RFC 9728/8414 discovery, the RFC 7591 registration branch and
  // the PKCE flow, in a fixed and load-bearing order — into `McpSignIn`
  // (src/domain/tools/sign-in.ts). Card 113 moved the other half out too: the
  // sign-in STATE MACHINE (which panel is showing, what is in flight, the
  // credential held until submit) is ../forms/oauthSignIn.svelte.ts, rendered
  // by ./McpOAuthPanel.svelte. What is left here is this form's own job —
  // fields, validation, the connection test, and what `buildServerConfig()`
  // submits. Nothing below names `chrome`.
  import { originPatternForUrl } from "../../domain/permissions";
  import type { Result } from "../../domain/result";
  import type { StorageError } from "../../domain/storage";
  import { uiTextDirection } from "../../ui/direction";
  import { storageFailureMessage } from "../../ui/storageMessage";
  import { mcpReservedHeaderMessage } from "../../ui/reservedHeaderMessage";
  import {
    firstHeaderError,
    toHeaderRows,
    type HeaderRow,
    type ReservedHeaderCheck,
  } from "../forms/headerRows";
  import {
    permissionDeniedMessage,
    requestHostPermission,
    trackHostPermission,
  } from "../forms/hostPermission.svelte";
  import { testMcpServerConnection, type McpTestOutcome } from "../forms/mcpTestConnection";
  import { createOAuthSignIn } from "../forms/oauthSignIn.svelte";
  import { m } from "../../paraglide/messages.js";
  import HeadersEditor from "./HeadersEditor.svelte";
  import McpOAuthPanel from "./McpOAuthPanel.svelte";
  import McpTestResult from "./McpTestResult.svelte";
  import * as Alert from "$lib/components/ui/alert";
  import * as Field from "$lib/components/ui/field";
  import * as InputGroup from "$lib/components/ui/input-group";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";

  interface Props {
    mode: "add" | "edit";
    initial?: McpServerConfig;
    /** Save the config. Card 95: returns the registry's own failure so this form can keep the user's input on screen with the reason — see ProviderForm.svelte's twin prop. */
    onSubmit: (data: Omit<McpServerConfig, "id">) => Promise<Result<void, StorageError>>;
    onCancel: () => void;
  }

  let { mode, initial, onSubmit, onCancel }: Props = $props();

  // Named separately (rather than reached via `TRANSPORT_OPTIONS[0]`) so the
  // fallback used below whenever a lookup misses is a value the compiler can
  // see is always defined, not an indexed access `noUncheckedIndexedAccess`
  // has to treat as possibly `undefined` (mirrors ProviderForm.svelte's
  // `OLLAMA_PROVIDER_TYPE`).
  const AUTO_TRANSPORT_OPTION: {
    value: McpTransportPreference;
    label: string;
    description: string;
  } = {
    value: "auto",
    label: m.mcpServerForm_transportAutoLabel(),
    description: m.mcpServerForm_transportAutoDescription(),
  };
  const TRANSPORT_OPTIONS: { value: McpTransportPreference; label: string; description: string }[] =
    [
      AUTO_TRANSPORT_OPTION,
      {
        value: "streamable-http",
        label: m.mcpServerForm_transportStreamableLabel(),
        description: m.mcpServerForm_transportStreamableDescription(),
      },
      {
        value: "sse",
        label: m.mcpServerForm_transportSseLabel(),
        description: m.mcpServerForm_transportSseDescription(),
      },
    ];

  // `initial` (when present) only ever seeds this form's editable state
  // once, at mount — same "uncontrolled after mount" posture as
  // ProviderForm.svelte, for the same reason (see that file's comment).
  let name = $state(untrack(() => initial?.name ?? ""));
  let url = $state(untrack(() => initial?.url ?? ""));
  let transport = $state<McpTransportPreference>(untrack(() => initial?.transport ?? "auto"));
  let enabled = untrack(() => initial?.enabled ?? true);

  // Card 62 widened `McpServerAuth` (src/domain/tools) to a
  // bearer/oauth union; this form now offers a three-way choice — None /
  // Bearer token / Sign in with OAuth — mirroring the `transport` `<select>`
  // above. `authMode` decides which of the two credential states below
  // `buildServerConfig()` reads from.
  type AuthMode = "none" | "bearer" | "oauth";
  let authMode = $state<AuthMode>(
    untrack(() =>
      initial?.auth?.type === "bearer"
        ? "bearer"
        : initial?.auth?.type === "oauth"
          ? "oauth"
          : "none",
    ),
  );

  let authToken = $state(
    untrack(() => (initial?.auth?.type === "bearer" ? initial.auth.token : "")),
  );
  let showAuthToken = $state(false);

  // Live permission-grant state for whatever URL is currently typed, so
  // "Test connection" can tell the user up front whether it will need to
  // prompt for a host permission (the same tracker ProviderForm.svelte uses).
  // Declared here rather than beside `testing` below because the OAuth
  // machine reads and writes it too — sign-in asks for the very same grant.
  const hostPermission = trackHostPermission(() => url);

  /**
   * The OAuth sign-in machine (../forms/oauthSignIn.svelte.ts, card 113),
   * rendered by ./McpOAuthPanel.svelte. Its credential is held in memory
   * only until the surrounding Add/Save submits `buildServerConfig()` —
   * exactly the same "nothing persists until submit" posture `authToken`
   * already has.
   */
  const oauth = createOAuthSignIn({
    serverUrl: () => url,
    hostPermission,
    initialAuth: untrack(() => (initial?.auth?.type === "oauth" ? initial.auth : undefined)),
  });

  /** Custom request headers (decisions/15-custom-headers-are-credentials.md), in the editor's row shape — see ../forms/headerRows.ts for why a row carries a synthetic id. */
  let headers = $state<HeaderRow[]>(
    untrack(() => toHeaderRows(Object.entries(initial?.headers ?? {}))),
  );

  /** Whether the draft currently has *some* auth that will put an `Authorization` header on the wire — a bearer token with text, or any held OAuth credential — regardless of which mode is selected. Feeds `validateServerHeaders`'s reserved-header check the same way `client.ts`'s own `hasResolvableAuth` decides whether `Authorization` is reserved. */
  function hasConfiguredAuth(): boolean {
    if (authMode === "bearer") return authToken.trim().length > 0;
    if (authMode === "oauth") return oauth.auth !== undefined;
    return false;
  }

  /**
   * This form's reserved-name rule, handed to the shared editor and to
   * `firstHeaderError`. Uses `validateServerHeaders` (src/domain/tools) — the
   * same function `client.ts` uses defensively at request-build time — so
   * this form and the transport agree on exactly which headers are reserved.
   * Reads the auth state reactively, so switching auth mode or clearing a
   * token re-evaluates every row live.
   */
  const isReservedHeader: ReservedHeaderCheck = (key, value) => {
    const issues = validateServerHeaders({ [key]: value }, { hasAuthToken: hasConfiguredAuth() });
    const [first] = issues;
    return first ? mcpReservedHeaderMessage(first.header, first.code) : undefined;
  };

  let saving = $state(false);
  let formError = $state<string | undefined>(undefined);

  let testing = $state(false);
  let testOutcome = $state<McpTestOutcome | undefined>(undefined);

  // Card 71: shadcn's `Select` renders whatever the trigger is given, unlike
  // the native `<select>` these replaced, which showed the chosen `<option>`'s
  // own text. Both lists stay the single source of truth for their labels.
  const NONE_AUTH_MODE_OPTION: { value: AuthMode; label: string } = {
    value: "none",
    label: m.mcpServerForm_authNoneLabel(),
  };
  const AUTH_MODE_OPTIONS: { value: AuthMode; label: string }[] = [
    NONE_AUTH_MODE_OPTION,
    { value: "bearer", label: m.bearerTokenLabel() },
    { value: "oauth", label: m.mcpServerForm_authOauthLabel() },
  ];
  let transportLabel = $derived(
    TRANSPORT_OPTIONS.find((t) => t.value === transport)?.label ?? AUTO_TRANSPORT_OPTION.label,
  );
  let authModeLabel = $derived(
    AUTH_MODE_OPTIONS.find((a) => a.value === authMode)?.label ?? NONE_AUTH_MODE_OPTION.label,
  );

  function buildServerConfig(): Omit<McpServerConfig, "id"> {
    const cleanHeaders: Record<string, string> = {};
    for (const h of headers) {
      const key = h.key.trim();
      const value = h.value.trim();
      if (key.length === 0 && value.length === 0) continue; // an added-but-empty row
      cleanHeaders[key] = value;
    }
    let auth: McpServerAuth | undefined;
    if (authMode === "bearer") {
      auth = authToken.trim().length > 0 ? { type: "bearer", token: authToken.trim() } : undefined;
    } else if (authMode === "oauth") {
      // `snapshotAuth()`, not a direct read of the machine's `auth` — see its
      // doc comment in ../forms/oauthSignIn.svelte.ts for the storage bug a
      // reactive Proxy causes here. This is the one place that credential
      // crosses out to `addServer`/`updateServer`.
      auth = oauth.snapshotAuth(); // undefined after Disconnect — persists as a cleared `auth` on submit, same as an emptied bearer token.
    }

    return {
      name: name.trim(),
      url: url.trim(),
      enabled,
      transport,
      auth,
      headers: Object.keys(cleanHeaders).length > 0 ? cleanHeaders : undefined,
    };
  }

  /**
   * "Test connection" — `requestHostPermission` is the first `await` here on
   * purpose (decisions/14, mirroring decisions/09's rule for providers): the
   * browser only honours the request while still inside the user gesture that
   * triggered it.
   */
  async function handleTest(): Promise<void> {
    testOutcome = undefined;
    const draft = buildServerConfig();
    if (!originPatternForUrl(draft.url)) {
      testOutcome = {
        kind: "invalid-response",
        message: m.mcpServerForm_invalidUrlTestError(),
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
      if (!(await requestHostPermission(draft.url, hostPermission))) {
        testOutcome = { kind: "permission-denied", message: permissionDeniedMessage() };
        return;
      }
      testOutcome = await testMcpServerConnection({ id: initial?.id ?? "draft", ...draft });
    } finally {
      testing = false;
    }
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    formError = undefined;

    if (name.trim().length === 0) {
      formError = m.enterDisplayNameError();
      return;
    }
    if (!originPatternForUrl(url.trim())) {
      formError = m.mcpServerForm_invalidUrlError();
      return;
    }
    const headerError = firstHeaderError(headers, isReservedHeader);
    if (headerError) {
      formError = headerError;
      return;
    }

    saving = true;
    const [, err] = await onSubmit(buildServerConfig());
    saving = false;
    if (err) formError = storageFailureMessage(m.mcpServerForm_saveFailedWhat(), err);
  }
</script>


<form class="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4" onsubmit={handleSubmit}>
  <div class="flex flex-wrap gap-4">
    <Field.Field class="flex-1 basis-50">
      <Field.Label for="mf-name">{m.displayNameLabel()}</Field.Label>
      <Input
        id="mf-name"
        type="text"
        bind:value={name}
        placeholder={m.mcpServerForm_namePlaceholder()}
        required
        class="text-sm"
      />
    </Field.Field>
    <Field.Field class="flex-1 basis-50">
      <Field.Label for="mf-transport">{m.mcpServerForm_transportLabel()}</Field.Label>
      <Select.Root
        type="single"
        value={transport}
        onValueChange={(next) => (transport = next as McpTransportPreference)}
      >
        <Select.Trigger id="mf-transport" class="w-full">{transportLabel}</Select.Trigger>
        <Select.Content dir={uiTextDirection()}>
          {#each TRANSPORT_OPTIONS as t (t.value)}
            <Select.Item value={t.value} label={t.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
  </div>

  <Field.Field>
    <Field.Label for="mf-url">{m.mcpServerForm_urlLabel()}</Field.Label>
    <Input
      id="mf-url"
      type="text"
      bind:value={url}
      placeholder={m.mcpServerForm_urlPlaceholder()}
      required
      class="text-sm"
    />
    {#if hostPermission.granted === false}
      <Badge variant="destructive" class="w-fit!">{m.permissionNeededForHostBadge()}</Badge>
    {:else if hostPermission.granted === true}
      <Badge variant="outline" class="w-fit!">{m.permissionGrantedBadge()}</Badge>
    {/if}
  </Field.Field>

  <Alert.Root class="bg-background">
    <Alert.Description>
      {m.mcpServerForm_stdioNotice()}
    </Alert.Description>
  </Alert.Root>

  <Field.Field>
    <Field.Label for="mf-auth-mode">{m.mcpServerForm_authModeLabel()}</Field.Label>
    <Select.Root
      type="single"
      value={authMode}
      onValueChange={(next) => (authMode = next as AuthMode)}
    >
      <Select.Trigger id="mf-auth-mode" class="w-full">{authModeLabel}</Select.Trigger>
      <Select.Content dir={uiTextDirection()}>
        {#each AUTH_MODE_OPTIONS as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </Field.Field>

  {#if authMode === "bearer"}
    <Field.Field>
      <Field.Label for="mf-token">{m.bearerTokenLabel()}</Field.Label>
      <InputGroup.Root>
        <InputGroup.Input
          id="mf-token"
          type={showAuthToken ? "text" : "password"}
          bind:value={authToken}
          placeholder={m.mcpServerForm_bearerTokenPlaceholder()}
          autocomplete="off"
          class="text-sm"
        />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button onclick={() => (showAuthToken = !showAuthToken)}>
            {showAuthToken ? m.hideAction() : m.showAction()}
          </InputGroup.Button>
        </InputGroup.Addon>
      </InputGroup.Root>
    </Field.Field>
  {:else if authMode === "oauth"}
    <McpOAuthPanel {oauth} />
  {/if}

  <!-- Static, developer-authored, no untrusted interpolation — {@html} is
       safe here (card 101's technique 1). -->
  {#snippet headersDescription()}
    {@html m.mcpServerForm_headersDescription()}
  {/snippet}

  <HeadersEditor
    bind:rows={headers}
    isReserved={isReservedHeader}
    firstInputId="mf-header-0-key"
    description={headersDescription}
  />

  <Alert.Root class="bg-background">
    <Alert.Description>
      {m.mcpServerForm_credentialWarning()}
    </Alert.Description>
  </Alert.Root>

  {#if formError}
    <Field.Error>{formError}</Field.Error>
  {/if}

  <McpTestResult outcome={testOutcome} />

  <div class="flex flex-wrap items-center gap-2">
    <Button type="submit" disabled={saving}>
      {saving ? m.savingLabel() : mode === "add" ? m.mcpServerForm_addAction() : m.saveChangesAction()}
    </Button>
    <Button variant="outline" onclick={handleTest} disabled={testing}>
      {testing ? m.testingLabel() : m.testConnectionAction()}
    </Button>
    <Button variant="ghost" onclick={onCancel}>{m.cancelAction()}</Button>
  </div>
</form>
