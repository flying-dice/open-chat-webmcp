<script lang="ts">
  // Add/edit form for one MCP server config (card 39,
  // decisions/14-backend-mcp-servers.md,
  // decisions/15-custom-headers-are-credentials.md). Deliberately mirrors
  // ProviderForm.svelte's shape closely — same "uncontrolled after mount"
  // seeding via `untrack`, same custom-headers editor pattern, same
  // send-every-field-on-submit posture — because this is exactly the same
  // kind of add/edit-a-remote-endpoint-with-optional-auth-and-headers form
  // the provider registry already established. The one real difference:
  // headers here are a `Record<string, string>` (src/lib/mcp/registry.ts's
  // `McpServerConfig.headers`), not an array of `{key, value}` — so this
  // form still edits an array of rows locally (for stable `{#each}` keys
  // while a row is mid-edit) but converts to/from a Record at the
  // load/submit boundary instead of passing the array straight through.
  //
  // Reserved-header validation reuses `validateServerHeaders`
  // (src/lib/mcp/registry.ts) — the MCP-specific version of
  // ProviderForm.svelte's `reservedHeaderReason` (src/lib/provider.ts, off
  // limits to this card) — rather than re-deriving the same rule a third
  // time.
  import { untrack } from "svelte";
  import {
    validateServerHeaders,
    type McpOAuthAuth,
    type McpServerAuth,
    type McpServerConfig,
    type McpTransportPreference,
  } from "../../lib/mcp/registry";
  import {
    discoverAuthorizationServer,
    registerClient,
    runAuthorizationFlow,
    type McpAuthorizationServerInfo,
  } from "../../lib/mcp/oauth";
  import { describeMcpError } from "../../lib/mcp/types";
  import { hasHostPermission, originPatternForUrl, requestHostPermission } from "../../lib/permissions";
  import { testMcpServerConnection, type McpTestOutcome } from "../lib/mcpTestConnection";
  import { testResultClass, testResultMessage, testResultTools } from "../lib/mcpTestResultDisplay";
  import * as Alert from "$lib/components/ui/alert";
  import * as Field from "$lib/components/ui/field";
  import * as InputGroup from "$lib/components/ui/input-group";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";

  interface Props {
    mode: "add" | "edit";
    initial?: McpServerConfig;
    onSubmit: (data: Omit<McpServerConfig, "id">) => Promise<void>;
    onCancel: () => void;
  }

  let { mode, initial, onSubmit, onCancel }: Props = $props();

  const TRANSPORT_OPTIONS: { value: McpTransportPreference; label: string; description: string }[] = [
    {
      value: "auto",
      label: "Auto (recommended)",
      description: "Tries the modern Streamable HTTP transport first, falling back to legacy HTTP+SSE.",
    },
    { value: "streamable-http", label: "Streamable HTTP", description: "Pin to the modern transport only." },
    { value: "sse", label: "HTTP+SSE (legacy)", description: "Pin to the deprecated transport only." },
  ];

  // `initial` (when present) only ever seeds this form's editable state
  // once, at mount — same "uncontrolled after mount" posture as
  // ProviderForm.svelte, for the same reason (see that file's comment).
  let name = $state(untrack(() => initial?.name ?? ""));
  let url = $state(untrack(() => initial?.url ?? ""));
  let transport = $state<McpTransportPreference>(untrack(() => initial?.transport ?? "auto"));
  let enabled = untrack(() => initial?.enabled ?? true);

  // Card 62 widened `McpServerAuth` (src/lib/mcp/registry.ts) to a
  // bearer/oauth union; this form now offers a three-way choice — None /
  // Bearer token / Sign in with OAuth — mirroring the `transport` `<select>`
  // above. `authMode` decides which of the two credential states below
  // `buildData()` reads from.
  type AuthMode = "none" | "bearer" | "oauth";
  let authMode = $state<AuthMode>(
    untrack(() => (initial?.auth?.type === "bearer" ? "bearer" : initial?.auth?.type === "oauth" ? "oauth" : "none")),
  );

  let authToken = $state(untrack(() => (initial?.auth?.type === "bearer" ? initial.auth.token : "")));
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

  /** `chrome.identity.getRedirectURL()`, guarded the same way `runAuthorizationFlow` guards it — a function rather than a module-level constant so it never runs outside a browser-extension context (e.g. a future test render). */
  function redirectUri(): string {
    return typeof chrome !== "undefined" && chrome.identity ? chrome.identity.getRedirectURL() : "";
  }

  async function copyRedirectUri(): Promise<void> {
    try {
      await navigator.clipboard.writeText(redirectUri());
      redirectUriCopied = true;
      setTimeout(() => (redirectUriCopied = false), 1500);
    } catch {
      // Clipboard access can fail for reasons outside this form's control
      // (permission, focus) — the field itself is still selectable text, so
      // this is a convenience, not the only way to get the value.
    }
  }

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
   * ok/error/neutral treatments src/options/lib/mcpTestResultDisplay.ts
   * hands out), because that is exactly what it is: the last known verdict
   * on whether this server's credentials work.
   */
  const OAUTH_STATUS_BASE = "rounded-lg border px-3 py-2 text-sm";
  const oauthStatusClass = $derived(
    oauthNeedsReconnect
      ? `${OAUTH_STATUS_BASE} border-destructive/40 bg-destructive/5 text-destructive`
      : oauthAuth
        ? `${OAUTH_STATUS_BASE} border-primary/40 bg-primary/5 text-foreground`
        : `${OAUTH_STATUS_BASE} text-muted-foreground`,
  );

  function oauthStatusText(): string {
    if (!oauthAuth) return "Not connected.";
    if (oauthNeedsReconnect) {
      return "Needs reconnect — the access token has expired and there's no refresh token to renew it automatically.";
    }
    if (oauthAuth.expiresAt !== undefined) {
      return `Connected — token valid until ${new Date(oauthAuth.expiresAt).toLocaleString()}.`;
    }
    return "Connected — no expiry known.";
  }

  interface HeaderRow {
    id: number;
    key: string;
    value: string;
  }
  const initialHeaderEntries = untrack(() => Object.entries(initial?.headers ?? {}));
  let nextHeaderRowId = untrack(() => initialHeaderEntries.length + 1);
  let headers = $state<HeaderRow[]>(
    initialHeaderEntries.map(([key, value], i) => ({ id: i, key, value })),
  );
  let showHeaderValues = $state(false);
  let toolsExpanded = $state(false);

  function addHeaderRow(): void {
    headers = [...headers, { id: nextHeaderRowId++, key: "", value: "" }];
  }
  function removeHeaderRow(id: number): void {
    headers = headers.filter((h) => h.id !== id);
  }

  /** Whether the draft currently has *some* auth that will put an `Authorization` header on the wire — a bearer token with text, or any held OAuth credential — regardless of which mode is selected. Feeds `validateServerHeaders`'s reserved-header check the same way `client.ts`'s own `hasResolvableAuth` decides whether `Authorization` is reserved. */
  function hasConfiguredAuth(): boolean {
    if (authMode === "bearer") return authToken.trim().length > 0;
    if (authMode === "oauth") return oauthAuth !== undefined;
    return false;
  }

  /**
   * Refuse a reserved header, or a name duplicated across rows, right where
   * it's being typed (decisions/15: "refused visibly at edit time, not
   * dropped silently at request time"). Uses `validateServerHeaders`
   * (src/lib/mcp/registry.ts) for the reserved-name check — the same
   * function `client.ts` uses defensively at request-build time — so this
   * form and the transport agree on exactly which headers are reserved.
   */
  function headerRowError(row: HeaderRow): string | undefined {
    const key = row.key.trim();
    const value = row.value.trim();
    if (key.length === 0 && value.length === 0) return undefined;
    if (key.length === 0) return "Enter a header name, or remove this row.";
    if (value.length === 0) return "Enter a value, or remove this row.";

    const issues = validateServerHeaders(
      { [key]: value },
      { hasAuthToken: hasConfiguredAuth() },
    );
    if (issues.length > 0) return issues[0].reason;

    const lower = key.toLowerCase();
    const duplicates = headers.filter((h) => h.key.trim().toLowerCase() === lower).length;
    if (duplicates > 1) return `"${key}" is already set on another row above.`;

    return undefined;
  }

  /** First header validation failure across every row, or `undefined` if all are clean — shared by "Test connection" and submit so neither sends a request built from an invalid header. */
  function firstHeaderError(): string | undefined {
    for (const row of headers) {
      const err = headerRowError(row);
      if (err) return `Header "${row.key.trim() || "(empty)"}": ${err}`;
    }
    return undefined;
  }

  let saving = $state(false);
  let formError = $state<string | undefined>(undefined);

  // Live permission-grant state for whatever URL is currently typed, so
  // "Test connection" can tell the user up front whether it will need to
  // prompt for a host permission (mirrors ProviderForm.svelte).
  let permissionGranted = $state<boolean | undefined>(undefined);
  $effect(() => {
    const u = url.trim();
    permissionGranted = undefined;
    if (!originPatternForUrl(u)) return;
    hasHostPermission(u).then((granted) => {
      permissionGranted = granted;
    });
  });

  let testing = $state(false);
  let testOutcome = $state<McpTestOutcome | undefined>(undefined);

  // Card 71: shadcn's `Select` renders whatever the trigger is given, unlike
  // the native `<select>` these replaced, which showed the chosen `<option>`'s
  // own text. Both lists stay the single source of truth for their labels.
  const AUTH_MODE_OPTIONS: { value: AuthMode; label: string }[] = [
    { value: "none", label: "None" },
    { value: "bearer", label: "Bearer token" },
    { value: "oauth", label: "Sign in with OAuth" },
  ];
  let transportLabel = $derived(
    TRANSPORT_OPTIONS.find((t) => t.value === transport)?.label ?? TRANSPORT_OPTIONS[0].label,
  );
  let authModeLabel = $derived(
    AUTH_MODE_OPTIONS.find((a) => a.value === authMode)?.label ?? AUTH_MODE_OPTIONS[0].label,
  );

  function buildData(): Omit<McpServerConfig, "id"> {
    const cleanHeaders: Record<string, string> = {};
    for (const h of headers) {
      const key = h.key.trim();
      const value = h.value.trim();
      if (key.length === 0 && value.length === 0) continue; // an added-but-empty row
      cleanHeaders[key] = value;
    }
    let auth: McpServerAuth | undefined = undefined;
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
   * "Test connection" — MUST call `chrome.permissions.request` as the first
   * `await` in this click-bound handler when permission isn't already known
   * to be granted (decisions/14, mirroring decisions/09's rule for
   * providers): the browser only honours the request while still inside the
   * user gesture that triggered it.
   */
  async function handleTest(): Promise<void> {
    testOutcome = undefined;
    const draft = buildData();
    if (!originPatternForUrl(draft.url)) {
      testOutcome = { kind: "invalid-response", message: "Enter a valid http:// or https:// URL first." };
      return;
    }
    const headerError = firstHeaderError();
    if (headerError) {
      testOutcome = { kind: "invalid-response", message: headerError };
      return;
    }
    testing = true;
    try {
      if (permissionGranted !== true) {
        const granted = await requestHostPermission(draft.url);
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
      testOutcome = await testMcpServerConnection({ id: initial?.id ?? "draft", ...draft });
    } finally {
      testing = false;
    }
  }

  /** Request host permission for every distinct origin among a discovered authorization server's endpoints — they may differ from the MCP server's own origin. Returns `false` (with `oauthError` set) if any is declined, still inside the caller's gesture. */
  async function grantEndpointPermissions(discovery: McpAuthorizationServerInfo): Promise<boolean> {
    const endpointUrls = [
      discovery.authorizationEndpoint,
      discovery.tokenEndpoint,
      discovery.registrationEndpoint,
    ].filter((u): u is string => u !== undefined);
    const distinctOrigins = new Map<string, string>(); // origin pattern -> a URL on that origin
    for (const endpointUrl of endpointUrls) {
      const pattern = originPatternForUrl(endpointUrl);
      if (pattern && !distinctOrigins.has(pattern)) distinctOrigins.set(pattern, endpointUrl);
    }
    for (const endpointUrl of distinctOrigins.values()) {
      const granted = await requestHostPermission(endpointUrl);
      if (!granted) {
        oauthError = `Permission to contact ${new URL(endpointUrl).origin} was declined — sign-in cannot continue.`;
        return false;
      }
    }
    return true;
  }

  /**
   * "Sign in" (OAuth mode) — decisions/27 + card 63. Every step below is
   * awaited in this one click-bound handler, with nothing deferred out of
   * it, because `chrome.identity.launchWebAuthFlow` (inside
   * `runAuthorizationFlow`) needs an active user gesture and Chrome's
   * tolerance for `await`ed work ahead of it isn't formally documented
   * (decisions/27's Consequences) — so this mirrors `handleTest`'s
   * permission-request-first discipline and then just keeps going, rather
   * than ever handing off to a `setTimeout` or a second handler.
   *
   * Order: (1) host permission for the MCP server's own URL, (2) discover
   * the authorization server, (3) host permission for each distinct
   * authorization/token/registration origin discovery names. From there:
   * if the server supports dynamic client registration (RFC 7591), (4)
   * register and (5) run the interactive flow — all in this same click, no
   * extra step for the common case. If it doesn't (e.g. GitHub's
   * `github.com/login/oauth`, which has no registration endpoint at all —
   * confirmed against the real server), this stops here and leaves
   * `oauthDiscovery` set so the template shows a manual client-id/secret
   * panel; `handleOAuthContinueManual` (below), bound to its own fresh
   * click, finishes the flow from there. Success lands in `oauthAuth`;
   * nothing is persisted to storage until the surrounding form submits.
   */
  async function handleOAuthSignIn(): Promise<void> {
    oauthError = undefined;
    oauthDiscovery = undefined;
    const serverUrl = url.trim();
    if (!originPatternForUrl(serverUrl)) {
      oauthError = "Enter a valid http:// or https:// URL first.";
      return;
    }

    oauthSigningIn = true;
    try {
      // 1. Host permission for the MCP server's own URL — same pattern as handleTest above.
      if (permissionGranted !== true) {
        const granted = await requestHostPermission(serverUrl);
        permissionGranted = granted;
        if (!granted) {
          oauthError =
            "This extension doesn't have permission to contact this host yet, and the request was declined.";
          return;
        }
      }

      // 2. Discover the authorization server (RFC 9728 / RFC 8414).
      const discovery = await discoverAuthorizationServer(serverUrl);
      if (!discovery.ok) {
        oauthError = describeMcpError(discovery.error);
        return;
      }

      // 3. Endpoint host permissions — needed either way (DCR or manual).
      if (!(await grantEndpointPermissions(discovery.value))) return;

      // 4/5. Dynamic client registration, if this server supports it —
      // otherwise hand off to the manual client-id panel.
      if (!discovery.value.registrationEndpoint) {
        oauthDiscovery = discovery.value;
        return;
      }
      const registration = await registerClient(discovery.value.registrationEndpoint, redirectUri());
      if (!registration.ok) {
        oauthError = describeMcpError(registration.error);
        return;
      }
      const flow = await runAuthorizationFlow(
        {
          serverUrl,
          clientId: registration.value.clientId,
          clientSecret: registration.value.clientSecret,
          scope: discovery.value.scopesSupported?.join(" "),
        },
        discovery.value,
      );
      if (!flow.ok) {
        oauthError = describeMcpError(flow.error);
        return;
      }

      oauthAuth = flow.value;
    } finally {
      oauthSigningIn = false;
    }
  }

  /**
   * "Continue" from the manual client-id panel — a fresh click, and
   * therefore its own fresh user gesture, so `runAuthorizationFlow`'s
   * `chrome.identity.launchWebAuthFlow` step is exactly as valid here as it
   * is from `handleOAuthSignIn`'s own first `await`. Host permissions for
   * the authorization/token endpoints were already requested by
   * `handleOAuthSignIn` before it handed off to this panel.
   */
  async function handleOAuthContinueManual(): Promise<void> {
    if (!oauthDiscovery) return;
    const clientId = manualClientId.trim();
    if (clientId.length === 0) {
      oauthError = "Enter the client ID from the OAuth app you registered.";
      return;
    }

    oauthError = undefined;
    oauthSigningIn = true;
    try {
      // Snapshot `oauthDiscovery` before it's threaded into the resulting
      // `McpOAuthAuth.authorizationServer` (`runAuthorizationFlow` carries
      // this `discovery` argument straight through) — otherwise `oauthAuth`
      // ends up holding a reactive Proxy nested inside plain state from the
      // moment it's created, not just when `buildData()` reads it out. See
      // the longer note at `buildData()`'s oauth branch for what breaks if a
      // Proxy reaches `chrome.storage` unsnapshotted.
      const discoverySnapshot = $state.snapshot(oauthDiscovery);
      const flow = await runAuthorizationFlow(
        {
          serverUrl: url.trim(),
          clientId,
          clientSecret: manualClientSecret.trim().length > 0 ? manualClientSecret.trim() : undefined,
          scope: discoverySnapshot.scopesSupported?.join(" "),
        },
        discoverySnapshot,
      );
      if (!flow.ok) {
        oauthError = describeMcpError(flow.error);
        return;
      }
      oauthAuth = flow.value;
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
      formError = "Enter a display name.";
      return;
    }
    if (!originPatternForUrl(url.trim())) {
      formError = "Enter a valid http:// or https:// URL.";
      return;
    }
    const headerError = firstHeaderError();
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
</script>


<form class="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4" onsubmit={handleSubmit}>
  <div class="flex flex-wrap gap-4">
    <Field.Field class="flex-1 basis-50">
      <Field.Label for="mf-name">Display name</Field.Label>
      <Input
        id="mf-name"
        type="text"
        bind:value={name}
        placeholder="e.g. Internal ticket tracker"
        required
      />
    </Field.Field>
    <Field.Field class="flex-1 basis-50">
      <Field.Label for="mf-transport">Transport</Field.Label>
      <Select.Root
        type="single"
        value={transport}
        onValueChange={(next) => (transport = next as McpTransportPreference)}
      >
        <Select.Trigger id="mf-transport" class="w-full">{transportLabel}</Select.Trigger>
        <Select.Content>
          {#each TRANSPORT_OPTIONS as t (t.value)}
            <Select.Item value={t.value} label={t.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
  </div>

  <Field.Field>
    <Field.Label for="mf-url">MCP endpoint URL</Field.Label>
    <Input id="mf-url" type="text" bind:value={url} placeholder="https://mcp.example.com/mcp" required />
    {#if permissionGranted === false}
      <Badge variant="destructive" class="w-fit!">Permission needed for this host</Badge>
    {:else if permissionGranted === true}
      <Badge variant="outline" class="w-fit!">Permission granted</Badge>
    {/if}
  </Field.Field>

  <Alert.Root class="bg-background">
    <Alert.Description>
      Only remote HTTP/SSE MCP servers are supported — this extension can't spawn or speak to a
      local stdio process. For a stdio-only server, put an off-the-shelf stdio-to-HTTP proxy in
      front of it and enter the proxy's URL here instead.
    </Alert.Description>
  </Alert.Root>

  <Field.Field>
    <Field.Label for="mf-auth-mode">Authentication</Field.Label>
    <Select.Root
      type="single"
      value={authMode}
      onValueChange={(next) => (authMode = next as AuthMode)}
    >
      <Select.Trigger id="mf-auth-mode" class="w-full">{authModeLabel}</Select.Trigger>
      <Select.Content>
        {#each AUTH_MODE_OPTIONS as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </Field.Field>

  {#if authMode === "bearer"}
    <Field.Field>
      <Field.Label for="mf-token">Bearer token</Field.Label>
      <InputGroup.Root>
        <InputGroup.Input
          id="mf-token"
          type={showAuthToken ? "text" : "password"}
          bind:value={authToken}
          placeholder="Sent as Authorization: Bearer …"
          autocomplete="off"
        />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button onclick={() => (showAuthToken = !showAuthToken)}>
            {showAuthToken ? "Hide" : "Show"}
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
        <Field.Title>Manual app registration</Field.Title>
        <Alert.Root class="bg-background">
          <Alert.Description>
            <code class="font-mono text-xs">{oauthDiscovery.issuer}</code> doesn't support automatic
            client registration. Create an OAuth app there using the callback URL below, then enter
            the client ID it gives you (and a client secret too, if it requires one).
          </Alert.Description>
        </Alert.Root>

        <Field.Label for="mf-oauth-redirect">Callback / redirect URL</Field.Label>
        <InputGroup.Root>
          <InputGroup.Input id="mf-oauth-redirect" type="text" value={redirectUri()} readonly />
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button onclick={copyRedirectUri}>
              {redirectUriCopied ? "Copied" : "Copy"}
            </InputGroup.Button>
          </InputGroup.Addon>
        </InputGroup.Root>

        <Field.Label for="mf-oauth-client-id">Client ID</Field.Label>
        <Input id="mf-oauth-client-id" type="text" bind:value={manualClientId} autocomplete="off" />

        <Field.Label for="mf-oauth-client-secret">Client secret (optional)</Field.Label>
        <InputGroup.Root>
          <InputGroup.Input
            id="mf-oauth-client-secret"
            type={showManualClientSecret ? "text" : "password"}
            bind:value={manualClientSecret}
            autocomplete="off"
          />
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button onclick={() => (showManualClientSecret = !showManualClientSecret)}>
              {showManualClientSecret ? "Hide" : "Show"}
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
            {oauthSigningIn ? "Signing in…" : "Continue"}
          </Button>
          <Button variant="ghost" onclick={handleOAuthCancelManual}>Cancel</Button>
        </div>
      {:else}
        <!-- Card 71: was a <label for="mf-oauth-signin"> pointing at the status
             <p> below — a label can only name a form control, so this is a
             group title now. The status text itself is unchanged. -->
        <Field.Title>OAuth sign-in</Field.Title>
        <p class={oauthStatusClass}>{oauthStatusText()}</p>
        {#if oauthError}
          <Field.Error>{oauthError}</Field.Error>
        {/if}
        <div class="flex items-center gap-2">
          <Button variant="outline" onclick={handleOAuthSignIn} disabled={oauthSigningIn}>
            {oauthSigningIn ? "Signing in…" : oauthAuth ? "Reconnect" : "Sign in"}
          </Button>
          {#if oauthAuth}
            <Button variant="ghost" onclick={handleOAuthDisconnect}>Disconnect</Button>
          {/if}
        </div>
        <Alert.Root class="bg-background">
          <Alert.Description>
            Discovers the server's authorization server and opens a sign-in window. If the server
            supports dynamic client registration (RFC 7591) this registers automatically; otherwise
            you'll be asked for a client ID from an app you register with it yourself.
          </Alert.Description>
        </Alert.Root>
      {/if}
    </Field.Field>
  {/if}

  <Field.Field>
    <Field.Label for="mf-header-0-key">Custom headers (optional)</Field.Label>
    <Alert.Root class="bg-background">
      <Alert.Description>
        Sent on every request to this server — for a gateway that wants its own <code
          class="font-mono text-xs">x-api-key</code
        >, a tenant or project header, or a proxy <code class="font-mono text-xs">Authorization</code
        >. A bearer token from the field above isn't enough for those.
      </Alert.Description>
    </Alert.Root>

    {#if headers.length > 0}
      <div class="flex flex-col gap-1">
        {#each headers as row, i (row.id)}
          {@const err = headerRowError(row)}
          <div class="flex items-start gap-1">
            <Input
              id={i === 0 ? "mf-header-0-key" : undefined}
              type="text"
              bind:value={row.key}
              placeholder="Header name, e.g. x-api-key"
              autocomplete="off"
              aria-invalid={err ? "true" : undefined}
            />
            <Input
              type={showHeaderValues ? "text" : "password"}
              bind:value={row.value}
              placeholder="Value"
              autocomplete="off"
              aria-invalid={err ? "true" : undefined}
            />
            <Button
              variant="ghost"
              size="icon"
              onclick={() => removeHeaderRow(row.id)}
              aria-label={`Remove header ${row.key || i + 1}`}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          </div>
          {#if err}
            <Field.Error>{err}</Field.Error>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="flex items-center gap-2">
      <Button variant="ghost" size="sm" onclick={addHeaderRow}>
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
        Add header
      </Button>
      {#if headers.length > 0}
        <Button variant="ghost" size="sm" onclick={() => (showHeaderValues = !showHeaderValues)}>
          {showHeaderValues ? "Hide values" : "Show values"}
        </Button>
      {/if}
    </div>
  </Field.Field>

  <Alert.Root class="bg-background">
    <Alert.Description>
      The bearer token, OAuth tokens, and custom header values above are stored unencrypted on this
      device (chrome.storage.local) and never synced to your Google account. Anyone with access to
      this browser profile's data can read them.
    </Alert.Description>
  </Alert.Root>

  {#if formError}
    <Field.Error>{formError}</Field.Error>
  {/if}

  {#if testOutcome}
    <p class={testResultClass(testOutcome)}>{testResultMessage(testOutcome)}</p>
    {#if testResultTools(testOutcome)}
      {@const tools = testResultTools(testOutcome) ?? []}
      <div class="flex">
        <Button variant="ghost" size="sm" onclick={() => (toolsExpanded = !toolsExpanded)}>
          {toolsExpanded ? "Hide" : "Show"}
          {tools.length} tool{tools.length === 1 ? "" : "s"}
        </Button>
      </div>
      {#if toolsExpanded}
        <ul class="flex list-disc flex-col gap-0.5 pl-6 text-xs text-muted-foreground">
          <!-- Keyed by index, not `tool.name`: this is a raw server-reported
               list, un-deduplicated (unlike the sidepanel's merged tool list,
               which `buildServerMergedTools` — src/lib/mcp/merge.ts —
               disambiguates). A real server can report two tools whose
               `title ?? name` fallback collides (confirmed against GitHub's
               MCP server, which crashed this exact `{#each}` with Svelte's
               `each_key_duplicate` error before this fix) — index is always
               unique for a wholesale-replaced, non-reorderable snapshot list
               like this one. -->
          {#each tools as tool, i (i)}
            <li>
              <code class="font-mono text-foreground">{tool.name}</code>{#if tool.description}<span
                >
                  — {tool.description}</span
                >{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <Button type="submit" disabled={saving}>
      {saving ? "Saving…" : mode === "add" ? "Add server" : "Save changes"}
    </Button>
    <Button variant="outline" onclick={handleTest} disabled={testing}>
      {testing ? "Testing…" : "Test connection"}
    </Button>
    <Button variant="ghost" onclick={onCancel}>Cancel</Button>
  </div>
</form>
