<script lang="ts">
  // TODO: clean-code - 0.5 - SRP: Bundles four largely independent UI concerns — basic fields, bearer-token entry, a full OAuth sign-in state machine with a nested manual-app-registration sub-flow, and connection-test orchestration — in one component.
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
    type McpAuthorizationServerInfo,
    type McpOAuthAuth,
    type McpServerAuth,
    type McpServerConfig,
    type McpTransportPreference,
  } from "../../domain/tools";
  // Card 78: the sign-in ORCHESTRATION this component used to run inline —
  // three host-permission requests, RFC 9728/8414 discovery, the RFC 7591
  // registration branch and the PKCE flow, in a fixed and load-bearing order —
  // is `McpSignIn` (src/domain/tools/sign-in.ts), reached through this
  // surface's services. What stays here is the form state machine: which
  // panel is showing, what the status line says, and what `buildData()`
  // submits. Nothing below names `chrome`.
  import { optionsServices } from "../app-services";
  import { originPatternForUrl } from "../../domain/permissions";
  import type { Result } from "../../domain/result";
  import type { StorageError } from "../../domain/storage";
  import { copyText } from "../../ui/clipboard";
  import { formatDateTime } from "../../ui/datetime";
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
  import { bannerClass } from "../forms/testResultDisplay";
  import { m } from "../../paraglide/messages.js";
  import HeadersEditor from "./HeadersEditor.svelte";
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
  // `buildData()` reads from.
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

  // The OAuth credential, held only in local state until the surrounding
  // Add/Save submits `buildData()` — exactly the same "nothing persists
  // until submit" posture `authToken` already has. Set by `handleOAuthSignIn`
  // below, cleared by "Disconnect".
  let oauthAuth = $state<McpOAuthAuth | undefined>(
    untrack(() => (initial?.auth?.type === "oauth" ? initial.auth : undefined)),
  );
  let oauthSigningIn = $state(false);
  let oauthError = $state<string | undefined>(undefined);

  // Set once discovery has succeeded but found no `registrationEndpoint` —
  // some real authorization servers (GitHub's, notably: github.com/login/oauth
  // has no RFC 7591 registration endpoint at all) require a manually
  // pre-registered app instead of dynamic client registration. While this is
  // set (and `oauthAuth` isn't), the template shows a manual client-id/secret
  // panel instead of going straight to sign-in. Cleared by `handleOAuthDisconnect`
  // and by `handleOAuthCancelManual`.
  let oauthDiscovery = $state<McpAuthorizationServerInfo | undefined>(undefined);
  let manualClientId = $state("");
  let manualClientSecret = $state("");
  let showManualClientSecret = $state(false);
  let redirectUriCopied = $state(false);

  /** The redirect URI the authorization flow actually sends (`McpOAuthClient.redirectUri`, src/domain/tools) — the value the user must register with their OAuth app. Read through the port rather than computed here, so the panel can never show a URI the flow does not use. */
  function redirectUri(): string {
    return optionsServices().mcpSignIn.redirectUri();
  }

  async function copyRedirectUri(): Promise<void> {
    // Card 95: the platform catch moved into src/ui/clipboard.ts's
    // never-throws wrapper. A refusal is still silent by design — the field
    // is selectable text, so copying is a convenience and not the only way to
    // get the value.
    if (!(await copyText(redirectUri()))) return;
    redirectUriCopied = true;
    setTimeout(() => (redirectUriCopied = false), 1500);
  }

  // TODO: clean-code - 0.3 - COUPLING: the "needs reconnect" rule (expiresAt <= Date.now() && !refreshToken) is duplicated inline in McpServerRow.svelte instead of living once in src/domain/tools.
  /** Mirrors the "reconnect needed" condition McpServerRow.svelte checks against a saved server — here checked against the live local `oauthAuth` state instead of a stored config, so the form's own status line agrees with the row's badge. */
  const oauthNeedsReconnect = $derived(
    oauthAuth !== undefined &&
      oauthAuth.expiresAt !== undefined &&
      oauthAuth.expiresAt <= Date.now() &&
      !oauthAuth.refreshToken,
  );

  /**
   * The OAuth status line's banner styling — card 71 kept it visually
   * identical to a "Test connection" result banner (the same three
   * ok/error/neutral treatments src/options/forms/testResultDisplay.ts's
   * `bannerClass` hands out), because that is exactly what it is: the last
   * known verdict on whether this server's credentials work.
   */
  const oauthStatusClass = $derived(
    bannerClass(oauthNeedsReconnect ? "error" : oauthAuth ? "ok" : "neutral"),
  );

  function oauthStatusText(): string {
    if (!oauthAuth) return m.mcpServerForm_oauthNotConnected();
    if (oauthNeedsReconnect) {
      return m.mcpServerForm_oauthNeedsReconnect();
    }
    if (oauthAuth.expiresAt !== undefined) {
      return m.mcpServerForm_oauthConnectedUntil({
        date: formatDateTime(oauthAuth.expiresAt),
      });
    }
    return m.mcpServerForm_oauthConnectedNoExpiry();
  }

  /** Custom request headers (decisions/15-custom-headers-are-credentials.md), in the editor's row shape — see ../forms/headerRows.ts for why a row carries a synthetic id. */
  let headers = $state<HeaderRow[]>(
    untrack(() => toHeaderRows(Object.entries(initial?.headers ?? {}))),
  );

  /** Whether the draft currently has *some* auth that will put an `Authorization` header on the wire — a bearer token with text, or any held OAuth credential — regardless of which mode is selected. Feeds `validateServerHeaders`'s reserved-header check the same way `client.ts`'s own `hasResolvableAuth` decides whether `Authorization` is reserved. */
  function hasConfiguredAuth(): boolean {
    if (authMode === "bearer") return authToken.trim().length > 0;
    if (authMode === "oauth") return oauthAuth !== undefined;
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

  // Live permission-grant state for whatever URL is currently typed, so
  // "Test connection" can tell the user up front whether it will need to
  // prompt for a host permission (the same tracker ProviderForm.svelte uses).
  const hostPermission = trackHostPermission(() => url);

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

  // TODO: clean-code - 0.15 - NAMING: buildData is a generic name for a well-typed, single-purpose builder — should convey it builds a server config (cf. ProviderForm.svelte's identically-named buildData).
  function buildData(): Omit<McpServerConfig, "id"> {
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
      // `$state.snapshot`, not `oauthAuth` directly: `oauthAuth` (and, for
      // the manual-client-id path, the `oauthDiscovery` it was partly built
      // from — see `handleOAuthContinueManual`) is Svelte reactive state, so
      // reading it back out returns a Proxy, not the plain object it was
      // assigned. `chrome.storage.local.set` doesn't preserve that Proxy's
      // array-ness for nested fields (confirmed: `authorizationServer.scopesSupported`
      // round-tripped as `{0: "repo", 1: "..."}` instead of a real array),
      // which then failed `isMcpServerAuth`'s `Array.isArray` check on the
      // next read and silently dropped the WHOLE auth object — exactly the
      // "saved OAuth server reopens as auth: none" bug. Snapshotting here,
      // at the one place this state crosses out to `addServer`/`updateServer`,
      // guarantees a plain, storage-safe object regardless of how many
      // reactive layers accumulated upstream.
      auth = oauthAuth ? $state.snapshot(oauthAuth) : undefined; // undefined after Disconnect — persists as a cleared `auth` on submit, same as an emptied bearer token.
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
    const draft = buildData();
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

  /**
   * "Sign in" (OAuth mode) — decisions/27 + card 63, and card 78's split.
   *
   * The ORDER the steps happen in (host permission for the MCP server, then
   * discovery, then a host permission for each distinct
   * authorization/token/registration origin discovery names, then either
   * dynamic registration + the interactive flow or a hand-off to the manual
   * client-id panel) is a rule, and it now lives in `McpSignIn`
   * (src/domain/tools/sign-in.ts). What is still this component's is the
   * three things it does with the answer: hold the credential in local state
   * until submit, show the error, or open the manual panel.
   *
   * Still awaited straight through from this one click handler, with nothing
   * deferred out of it, because `chrome.identity.launchWebAuthFlow` (inside
   * the flow) needs an active user gesture and Chrome's tolerance for
   * `await`ed work ahead of it isn't formally documented (decisions/27's
   * Consequences). Moving the steps behind a port did not change that: they
   * are the same awaits in the same order in the same call chain — the
   * service never hands off to a `setTimeout` or a second handler either.
   */
  async function handleOAuthSignIn(): Promise<void> {
    oauthError = undefined;
    oauthDiscovery = undefined;

    oauthSigningIn = true;
    try {
      const result = await optionsServices().mcpSignIn.begin(url.trim(), {
        alreadyGranted: hostPermission.granted === true,
        onServerPermission: (granted) => (hostPermission.granted = granted),
      });
      if (result.status === "error") {
        oauthError = result.message;
        return;
      }
      if (result.status === "needs-manual-client") {
        // Some real authorization servers (GitHub's, notably:
        // github.com/login/oauth has no RFC 7591 registration endpoint at
        // all) require a manually pre-registered app. While this is set (and
        // `oauthAuth` isn't), the template shows the manual client-id/secret
        // panel instead of a plain sign-in button.
        oauthDiscovery = result.discovery;
        return;
      }
      oauthAuth = result.auth;
    } finally {
      oauthSigningIn = false;
    }
  }

  /**
   * "Continue" from the manual client-id panel — a fresh click, and
   * therefore its own fresh user gesture, so the flow's
   * `launchWebAuthFlow` step is exactly as valid here as it is from
   * {@link handleOAuthSignIn}'s own first `await`. Host permissions for the
   * authorization/token endpoints were already requested by the `begin` that
   * produced `oauthDiscovery`.
   */
  async function handleOAuthContinueManual(): Promise<void> {
    if (!oauthDiscovery) return;

    oauthError = undefined;
    oauthSigningIn = true;
    try {
      // Snapshot `oauthDiscovery` before it's threaded into the resulting
      // `McpOAuthAuth.authorizationServer` (the flow carries this `discovery`
      // argument straight through) — otherwise `oauthAuth` ends up holding a
      // reactive Proxy nested inside plain state from the moment it's
      // created, not just when `buildData()` reads it out. See the longer
      // note at `buildData()`'s oauth branch for what breaks if a Proxy
      // reaches `chrome.storage` unsnapshotted.
      const result = await optionsServices().mcpSignIn.completeManual({
        serverUrl: url.trim(),
        clientId: manualClientId,
        clientSecret: manualClientSecret,
        discovery: $state.snapshot(oauthDiscovery),
      });
      if (result.status === "error") {
        oauthError = result.message;
        return;
      }
      oauthAuth = result.auth;
      oauthDiscovery = undefined;
      manualClientId = "";
      manualClientSecret = "";
    } finally {
      oauthSigningIn = false;
    }
  }

  function handleOAuthCancelManual(): void {
    oauthDiscovery = undefined;
    manualClientId = "";
    manualClientSecret = "";
    oauthError = undefined;
  }

  function handleOAuthDisconnect(): void {
    oauthAuth = undefined;
    oauthDiscovery = undefined;
    manualClientId = "";
    manualClientSecret = "";
    oauthError = undefined;
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
    const [, err] = await onSubmit(buildData());
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
    <Field.Field>
      {#if oauthDiscovery && !oauthAuth}
        <!-- Card 71: this heading used to be a <label for="mf-oauth-client-id">
             that duplicated the real Client ID label below it (two labels, one
             control). It is a group heading, not a label, so it is one now —
             the panel's fields and flow are otherwise untouched. -->
        <Field.Title>{m.mcpServerForm_manualRegistrationTitle()}</Field.Title>
        <Alert.Root class="bg-background">
          <Alert.Description>
            <code class="font-mono text-xs" dir="ltr">{oauthDiscovery.issuer}</code>
            {m.mcpServerForm_manualRegistrationNotice()}
          </Alert.Description>
        </Alert.Root>

        <Field.Label for="mf-oauth-redirect">{m.mcpServerForm_redirectUrlLabel()}</Field.Label>
        <InputGroup.Root>
          <InputGroup.Input id="mf-oauth-redirect" type="text" value={redirectUri()} readonly class="text-sm" />
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button onclick={copyRedirectUri}>
              {redirectUriCopied ? m.copiedLabel() : m.markdown_copyButtonLabel()}
            </InputGroup.Button>
          </InputGroup.Addon>
        </InputGroup.Root>

        <Field.Label for="mf-oauth-client-id">{m.mcpServerForm_clientIdLabel()}</Field.Label>
        <Input id="mf-oauth-client-id" type="text" bind:value={manualClientId} autocomplete="off" class="text-sm" />

        <Field.Label for="mf-oauth-client-secret">{m.mcpServerForm_clientSecretLabel()}</Field.Label>
        <InputGroup.Root>
          <InputGroup.Input
            id="mf-oauth-client-secret"
            type={showManualClientSecret ? "text" : "password"}
            bind:value={manualClientSecret}
            autocomplete="off"
            class="text-sm"
          />
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button onclick={() => (showManualClientSecret = !showManualClientSecret)}>
              {showManualClientSecret ? m.hideAction() : m.showAction()}
            </InputGroup.Button>
          </InputGroup.Addon>
        </InputGroup.Root>

        {#if oauthError}
          <Field.Error>{oauthError}</Field.Error>
        {/if}
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            onclick={handleOAuthContinueManual}
            disabled={oauthSigningIn || manualClientId.trim().length === 0}
          >
            {oauthSigningIn ? m.mcpServerForm_signingInLabel() : m.mcpServerForm_continueAction()}
          </Button>
          <Button variant="ghost" onclick={handleOAuthCancelManual}>{m.cancelAction()}</Button>
        </div>
      {:else}
        <!-- Card 71: was a <label for="mf-oauth-signin"> pointing at the status
             <p> below — a label can only name a form control, so this is a
             group title now. The status text itself is unchanged. -->
        <Field.Title>{m.mcpServerForm_oauthSignInTitle()}</Field.Title>
        <p class={oauthStatusClass}>{oauthStatusText()}</p>
        {#if oauthError}
          <Field.Error>{oauthError}</Field.Error>
        {/if}
        <div class="flex items-center gap-2">
          <Button variant="outline" onclick={handleOAuthSignIn} disabled={oauthSigningIn}>
            {oauthSigningIn
              ? m.mcpServerForm_signingInLabel()
              : oauthAuth
                ? m.mcpServerForm_reconnectAction()
                : m.mcpServerForm_signInAction()}
          </Button>
          {#if oauthAuth}
            <Button variant="ghost" onclick={handleOAuthDisconnect}>{m.mcpServerForm_disconnectAction()}</Button>
          {/if}
        </div>
        <Alert.Root class="bg-background">
          <Alert.Description>
            {m.mcpServerForm_oauthDiscoveryNotice()}
          </Alert.Description>
        </Alert.Root>
      {/if}
    </Field.Field>
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
