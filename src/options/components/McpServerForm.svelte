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
    type McpServerAuth,
    type McpServerConfig,
    type McpTransportPreference,
  } from "../../lib/mcp/registry";
  import { hasHostPermission, originPatternForUrl, requestHostPermission } from "../../lib/permissions";
  import { testMcpServerConnection, type McpTestOutcome } from "../lib/mcpTestConnection";
  import { testResultClass, testResultMessage, testResultTools } from "../lib/mcpTestResultDisplay";

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
  let authToken = $state(untrack(() => initial?.auth?.token ?? ""));
  let showAuthToken = $state(false);

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

  function addHeaderRow(): void {
    headers = [...headers, { id: nextHeaderRowId++, key: "", value: "" }];
  }
  function removeHeaderRow(id: number): void {
    headers = headers.filter((h) => h.id !== id);
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
      { hasAuthToken: authToken.trim().length > 0 },
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

  function buildData(): Omit<McpServerConfig, "id"> {
    const cleanHeaders: Record<string, string> = {};
    for (const h of headers) {
      const key = h.key.trim();
      const value = h.value.trim();
      if (key.length === 0 && value.length === 0) continue; // an added-but-empty row
      cleanHeaders[key] = value;
    }
    const auth: McpServerAuth | undefined =
      authToken.trim().length > 0 ? { type: "bearer", token: authToken.trim() } : undefined;

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

<form class="form" onsubmit={handleSubmit}>
  <div class="field-row">
    <div class="field">
      <label for="mf-name">Display name</label>
      <input id="mf-name" type="text" bind:value={name} placeholder="e.g. Internal ticket tracker" required />
    </div>
    <div class="field">
      <label for="mf-transport">Transport</label>
      <select id="mf-transport" bind:value={transport}>
        {#each TRANSPORT_OPTIONS as t (t.value)}
          <option value={t.value}>{t.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="field">
    <label for="mf-url">MCP endpoint URL</label>
    <input id="mf-url" type="text" bind:value={url} placeholder="https://mcp.example.com/mcp" required />
    {#if permissionGranted === false}
      <span class="badge badge--danger">Permission needed for this host</span>
    {:else if permissionGranted === true}
      <span class="badge">Permission granted</span>
    {/if}
  </div>

  <p class="note">
    Only remote HTTP/SSE MCP servers are supported — this extension can't spawn or speak to a
    local stdio process. For a stdio-only server, put an off-the-shelf stdio-to-HTTP proxy in
    front of it and enter the proxy's URL here instead.
  </p>

  <div class="field">
    <label for="mf-token">Bearer token (optional)</label>
    <div class="api-key-field">
      <input
        id="mf-token"
        type={showAuthToken ? "text" : "password"}
        bind:value={authToken}
        placeholder="Sent as Authorization: Bearer …"
        autocomplete="off"
      />
      <button type="button" class="btn-plain" onclick={() => (showAuthToken = !showAuthToken)}>
        {showAuthToken ? "Hide" : "Show"}
      </button>
    </div>
  </div>

  <div class="field">
    <label for="mf-header-0-key">Custom headers (optional)</label>
    <p class="note">
      Sent on every request to this server — for a gateway that wants its own <code
        >x-api-key</code
      >, a tenant or project header, or a proxy <code>Authorization</code>. A bearer token from the
      field above isn't enough for those.
    </p>

    {#if headers.length > 0}
      <div class="header-rows">
        {#each headers as row, i (row.id)}
          {@const err = headerRowError(row)}
          <div class="header-row">
            <input
              id={i === 0 ? "mf-header-0-key" : undefined}
              type="text"
              bind:value={row.key}
              placeholder="Header name, e.g. x-api-key"
              autocomplete="off"
              aria-invalid={err ? "true" : undefined}
            />
            <input
              type={showHeaderValues ? "text" : "password"}
              bind:value={row.value}
              placeholder="Value"
              autocomplete="off"
              aria-invalid={err ? "true" : undefined}
            />
            <button
              type="button"
              class="btn-plain"
              onclick={() => removeHeaderRow(row.id)}
              aria-label={`Remove header ${row.key || i + 1}`}
            >
              Remove
            </button>
          </div>
          {#if err}
            <p class="header-row__error">{err}</p>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="form__actions">
      <button type="button" class="btn-plain" onclick={addHeaderRow}>+ Add header</button>
      {#if headers.length > 0}
        <button type="button" class="btn-plain" onclick={() => (showHeaderValues = !showHeaderValues)}>
          {showHeaderValues ? "Hide values" : "Show values"}
        </button>
      {/if}
    </div>
  </div>

  <p class="note">
    The bearer token and custom header values above are stored unencrypted on this device
    (chrome.storage.local) and never synced to your Google account. Anyone with access to this
    browser profile's data can read them.
  </p>

  {#if formError}
    <p class="form__error">{formError}</p>
  {/if}

  {#if testOutcome}
    <p class={`test-result ${testResultClass(testOutcome)}`}>{testResultMessage(testOutcome)}</p>
    {#if testResultTools(testOutcome)}
      {@const tools = testResultTools(testOutcome) ?? []}
      <ul class="mcp-tool-list">
        {#each tools as tool (tool.name)}
          <li><code>{tool.name}</code>{#if tool.description}<span> — {tool.description}</span>{/if}</li>
        {/each}
      </ul>
    {/if}
  {/if}

  <div class="form__actions">
    <button type="submit" class="btn-primary" disabled={saving}>
      {saving ? "Saving…" : mode === "add" ? "Add server" : "Save changes"}
    </button>
    <button type="button" onclick={handleTest} disabled={testing}>
      {testing ? "Testing…" : "Test connection"}
    </button>
    <button type="button" class="btn-plain" onclick={onCancel}>Cancel</button>
  </div>
</form>
