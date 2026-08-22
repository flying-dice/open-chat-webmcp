<script lang="ts">
  // The OAuth half of the MCP server form (card 113, split out of
  // McpServerForm.svelte's 0.5 SRP marker). Two mutually exclusive panels
  // over one state machine (../forms/oauthSignIn.svelte.ts):
  //
  //   - the manual client-id/secret registration panel, shown when discovery
  //     found no RFC 7591 registration endpoint (decisions/27, card 63); and
  //   - the sign-in status line with its Sign in / Reconnect / Disconnect
  //     buttons.
  //
  // Everything here is presentation: which panel, what the status line says,
  // and the two view-only toggles below (whether the client secret is
  // revealed, and the copied-the-redirect-URI flash). The transitions live in
  // the state machine; the flow itself lives in `McpSignIn`
  // (src/domain/tools/sign-in.ts). This component names no platform API, and
  // — importantly for decisions/27 — adds no `await` of its own between the
  // click and the machine: `signIn`/`continueManual` are passed straight to
  // `onclick` so the user gesture reaches `launchWebAuthFlow` intact.
  import type { OAuthSignInState } from "../forms/oauthSignIn.svelte";
  import { bannerClass } from "../forms/testResultDisplay";
  import { copyText } from "../../ui/clipboard";
  import { formatDateTime } from "../../ui/datetime";
  import { m } from "../../paraglide/messages.js";
  import * as Alert from "$lib/components/ui/alert";
  import * as Field from "$lib/components/ui/field";
  import * as InputGroup from "$lib/components/ui/input-group";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";

  interface Props {
    oauth: OAuthSignInState;
  }

  let { oauth }: Props = $props();

  let showManualClientSecret = $state(false);
  let redirectUriCopied = $state(false);

  async function copyRedirectUri(): Promise<void> {
    // Card 95: the platform catch moved into src/ui/clipboard.ts's
    // never-throws wrapper. A refusal is still silent by design — the field
    // is selectable text, so copying is a convenience and not the only way to
    // get the value.
    if (!(await copyText(oauth.redirectUri()))) return;
    redirectUriCopied = true;
    setTimeout(() => (redirectUriCopied = false), 1500);
  }

  /**
   * The status line's banner styling — card 71 kept it visually identical to
   * a "Test connection" result banner (the same three ok/error/neutral
   * treatments src/options/forms/testResultDisplay.ts's `bannerClass` hands
   * out), because that is exactly what it is: the last known verdict on
   * whether this server's credentials work.
   */
  const statusClass = $derived(
    bannerClass(oauth.needsReconnect ? "error" : oauth.auth ? "ok" : "neutral"),
  );

  function statusText(): string {
    const auth = oauth.auth;
    if (!auth) return m.mcpServerForm_oauthNotConnected();
    if (oauth.needsReconnect) return m.mcpServerForm_oauthNeedsReconnect();
    if (auth.expiresAt !== undefined) {
      return m.mcpServerForm_oauthConnectedUntil({ date: formatDateTime(auth.expiresAt) });
    }
    return m.mcpServerForm_oauthConnectedNoExpiry();
  }
</script>

<Field.Field>
  {#if oauth.showsManualPanel}
    <!-- Card 71: this heading used to be a <label for="mf-oauth-client-id">
         that duplicated the real Client ID label below it (two labels, one
         control). It is a group heading, not a label, so it is one now —
         the panel's fields and flow are otherwise untouched. -->
    <Field.Title>{m.mcpServerForm_manualRegistrationTitle()}</Field.Title>
    <Alert.Root class="bg-background">
      <Alert.Description>
        <code class="font-mono text-xs" dir="ltr">{oauth.discovery?.issuer}</code>
        {m.mcpServerForm_manualRegistrationNotice()}
      </Alert.Description>
    </Alert.Root>

    <Field.Label for="mf-oauth-redirect">{m.mcpServerForm_redirectUrlLabel()}</Field.Label>
    <InputGroup.Root>
      <InputGroup.Input id="mf-oauth-redirect" type="text" value={oauth.redirectUri()} readonly class="text-sm" />
      <InputGroup.Addon align="inline-end">
        <InputGroup.Button onclick={copyRedirectUri}>
          {redirectUriCopied ? m.copiedLabel() : m.markdown_copyButtonLabel()}
        </InputGroup.Button>
      </InputGroup.Addon>
    </InputGroup.Root>

    <Field.Label for="mf-oauth-client-id">{m.mcpServerForm_clientIdLabel()}</Field.Label>
    <Input id="mf-oauth-client-id" type="text" bind:value={oauth.manualClientId} autocomplete="off" class="text-sm" />

    <Field.Label for="mf-oauth-client-secret">{m.mcpServerForm_clientSecretLabel()}</Field.Label>
    <InputGroup.Root>
      <InputGroup.Input
        id="mf-oauth-client-secret"
        type={showManualClientSecret ? "text" : "password"}
        bind:value={oauth.manualClientSecret}
        autocomplete="off"
        class="text-sm"
      />
      <InputGroup.Addon align="inline-end">
        <InputGroup.Button onclick={() => (showManualClientSecret = !showManualClientSecret)}>
          {showManualClientSecret ? m.hideAction() : m.showAction()}
        </InputGroup.Button>
      </InputGroup.Addon>
    </InputGroup.Root>

    {#if oauth.error}
      <Field.Error>{oauth.error}</Field.Error>
    {/if}
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        onclick={oauth.continueManual}
        disabled={oauth.signingIn || oauth.manualClientId.trim().length === 0}
      >
        {oauth.signingIn ? m.mcpServerForm_signingInLabel() : m.mcpServerForm_continueAction()}
      </Button>
      <Button variant="ghost" onclick={oauth.cancelManual}>{m.cancelAction()}</Button>
    </div>
  {:else}
    <!-- Card 71: was a <label for="mf-oauth-signin"> pointing at the status
         <p> below — a label can only name a form control, so this is a
         group title now. The status text itself is unchanged. -->
    <Field.Title>{m.mcpServerForm_oauthSignInTitle()}</Field.Title>
    <p class={statusClass}>{statusText()}</p>
    {#if oauth.error}
      <Field.Error>{oauth.error}</Field.Error>
    {/if}
    <div class="flex items-center gap-2">
      <Button variant="outline" onclick={oauth.signIn} disabled={oauth.signingIn}>
        {oauth.signingIn
          ? m.mcpServerForm_signingInLabel()
          : oauth.auth
            ? m.mcpServerForm_reconnectAction()
            : m.mcpServerForm_signInAction()}
      </Button>
      {#if oauth.auth}
        <Button variant="ghost" onclick={oauth.disconnect}>{m.mcpServerForm_disconnectAction()}</Button>
      {/if}
    </div>
    <Alert.Root class="bg-background">
      <Alert.Description>
        {m.mcpServerForm_oauthDiscoveryNotice()}
      </Alert.Description>
    </Alert.Root>
  {/if}
</Field.Field>
