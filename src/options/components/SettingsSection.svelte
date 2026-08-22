<script lang="ts">
  // Card 13: the two approval policies. Both live in this one component
  // (mounted once from App.svelte, per the comment there) because they're
  // plain preferences rather than anything with its own CRUD flow like
  // ProvidersSection — each still gets its own `Card` so they read as two
  // settings, not one crowded one.
  //
  // Approval policy (decisions/05-tool-approval-policy.md): stored via
  // the `SettingsStore` port — the typed getter/setter/subscription
  // contract card 09's side-panel approval UI reads to decide whether a tool call
  // needs a human's OK. This component only lets the user pick which of the
  // three policies is active — it does not itself judge any tool call.
  //
  // MCP server approval policy (card 38,
  // decisions/20-approval-policy-is-per-tool-source.md): a SEPARATE
  // setting, its own section below, its own radio group, its own state and
  // subscription — decision 20 exists specifically so that changing "auto-run
  // read-only page tools" can never silently also relax what a remote MCP
  // server is allowed to do unattended. The two sections intentionally do
  // not share a component, a type, or a description string.
  //
  // The chat-history controls that used to be a third section here now live
  // in HistorySection.svelte, so App.svelte can order them below the MCP
  // servers registry.
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): the hand-rolled
  // `.policy-option` radio cards became shadcn `RadioGroup` + `Field`, whose
  // `has-data-checked:` label styling gives the selected option its own
  // treatment for free. Both groups stay CONTROLLED (`value` in,
  // `onValueChange` out) rather than `bind:value`, because the optimistic
  // write below has to be able to revert the selection when the storage write
  // throws — a two-way binding would leave the UI showing a policy that was
  // never saved.
  //
  // Card 100 (decisions/37-i18n-paraglide.md) adds a THIRD section, first in
  // the card: the interface language. It is a display preference rather than
  // a security policy, and unlike the two below it is not stored through the
  // `SettingsStore` port at all — see the language block further down for why
  // that is deliberate and not an oversight.
  import { onDestroy, onMount } from "svelte";
  import type { ApprovalPolicy, McpApprovalPolicy } from "../../domain/settings";
  import { storageFailureMessage } from "../../ui/storageMessage";
  import { optionsServices } from "../app-services";
  import { m } from "../../paraglide/messages.js";
  import { getLocale, locales, setLocale, type Locale } from "../../paraglide/runtime.js";
  import * as Alert from "$lib/components/ui/alert";
  import * as Card from "$lib/components/ui/card";
  import * as Field from "$lib/components/ui/field";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { RadioGroup, RadioGroupItem } from "$lib/components/ui/radio-group";

  // TODO: clean-code - 0.15 - DRY: the page-policy and MCP-policy option arrays and their RadioGroup/Field render blocks are structurally identical (same shape, different data) — kept deliberate/low per decisions/20's "an edit to one must never accidentally change the other", same rationale as approval-policy.ts.
  const POLICY_OPTIONS: {
    value: ApprovalPolicy;
    label: string;
    description: string;
    danger?: boolean;
  }[] = [
    {
      value: "default",
      label: m.settingsSection_defaultPolicyLabel(),
      description: m.settingsSection_defaultPolicyDescription(),
    },
    {
      value: "always-confirm",
      label: m.settingsSection_alwaysConfirmPolicyLabel(),
      description: m.settingsSection_alwaysConfirmPolicyDescription(),
    },
    {
      value: "auto-run-all",
      label: m.settingsSection_autoRunAllPolicyLabel(),
      description: m.settingsSection_autoRunAllPolicyDescription(),
      danger: true,
    },
  ];

  // decisions/20: a REMOTE server's own "I'm read-only" claim isn't seen by
  // the user the way a page's is, so the default here is the strictest of
  // the three — every call asks — and "trust read-only" is an explicit
  // opt-in described as exactly that, never phrased to sound like the page
  // policy's "default".
  const MCP_POLICY_OPTIONS: {
    value: McpApprovalPolicy;
    label: string;
    description: string;
    danger?: boolean;
  }[] = [
    {
      value: "always-confirm",
      label: m.settingsSection_mcpAlwaysConfirmLabel(),
      description: m.settingsSection_mcpAlwaysConfirmDescription(),
    },
    {
      value: "trust-read-only",
      label: m.settingsSection_mcpTrustReadOnlyLabel(),
      description: m.settingsSection_mcpTrustReadOnlyDescription(),
    },
    {
      value: "auto-run-all",
      // Byte-identical wording to the page policy's own "Auto-run everything"
      // (settingsSection_autoRunAllPolicyLabel) — reused rather than
      // duplicated, same word for the same concept in the same component.
      label: m.settingsSection_autoRunAllPolicyLabel(),
      description: m.settingsSection_mcpAutoRunAllDescription(),
      danger: true,
    },
  ];

  // -------------------------------------------------------------------------
  // Interface language (card 100, decisions/37-i18n-paraglide.md)
  //
  // NOT stored through `SettingsStore` like the two policies below, and that
  // asymmetry is the point. Paraglide resolves the active locale itself, from
  // the strategy chain in paraglide.options.mjs (localStorage →
  // preferredLanguage → baseLocale), and `setLocale()` is what writes the
  // localStorage half of it. Mirroring the value into `chrome.storage` as
  // well would give the page two sources of truth for one setting, and the
  // one the compiled message functions actually read would be the one we did
  // not control.
  //
  // The two surfaces share that value for free: the side panel and this page
  // are both documents on the same `chrome-extension://<id>` origin, so they
  // see one localStorage. Card 100 verified that in a real Chrome rather than
  // assuming it (see the card's journal) — had it been false, decision 37's
  // fallback was a custom `chrome.storage.local` strategy.
  //
  // `setLocale()` reloads the document by default and this component leans on
  // that: with the page gone there is no stale copy to keep reactive, and
  // src/options/main.ts re-runs `applyDocumentLocale()` on the way back up,
  // so `<html lang>`/`<html dir>` follow the switch with no extra wiring.
  // decisions/37 chose this over Paraglide's `{ reload: false }` escape hatch,
  // which needs a hand-rolled reactivity layer around every `m.someKey()`.
  //
  // ONE locale ships today (`en`), so this Select currently offers a single
  // option — card 105 is what fills the list out. It renders anyway rather
  // than hiding until there are two: an empty-looking control is honest about
  // where the feature is, and it is the thing card 105 will exercise.
  const currentLocale = getLocale();

  /**
   * A locale's name IN ITS OWN LANGUAGE — "Deutsch", not "German". That is the
   * convention a language picker is read by: someone who has landed in the
   * wrong locale needs to recognise their own language in the list, which they
   * cannot do if the list is written in the language they are trying to leave.
   *
   * `Intl.DisplayNames` throws a RangeError on a tag it cannot parse. That
   * cannot happen here — the input is one of the compiled `locales`, a
   * `readonly ["en"]` tuple the compiler produced from
   * project.inlang/settings.json — but the tag is still echoed as a fallback
   * rather than left to take the page down over a label
   * (decisions/34-errors-as-values.md).
   */
  function localeLabel(locale: Locale): string {
    try {
      return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
    } catch {
      return locale;
    }
  }

  const LOCALE_OPTIONS: { value: Locale; label: string }[] = locales.map((locale) => ({
    value: locale,
    label: localeLabel(locale),
  }));

  function handleLocaleChange(next: string): void {
    if (next === currentLocale) return;
    // Full-document reload (Paraglide's default) — nothing after this line in
    // this component runs, which is why there is no local `locale` state to
    // roll back the way the two policies below have.
    setLocale(next as Locale);
  }

  let policy = $state<ApprovalPolicy>("default");
  let policyLoading = $state(true);
  /**
   * Card 95: what replaced the rethrow. One message per group, cleared by the
   * next successful change — both a READ that could not be trusted (the group
   * is showing the documented default, which may not be what is stored) and a
   * WRITE that did not land (the selection has just snapped back) end up here,
   * because from the user's side they are the same fact: what this page shows
   * and what the extension will actually do may differ.
   */
  let policyFailure = $state<string | undefined>(undefined);

  let mcpPolicy = $state<McpApprovalPolicy>("always-confirm");
  let mcpPolicyLoading = $state(true);
  let mcpPolicyFailure = $state<string | undefined>(undefined);

  let unsubscribePolicy: (() => void) | undefined;
  let unsubscribeMcpPolicy: (() => void) | undefined;

  onMount(() => {
    // Card 92: an unreadable policy leaves each radio group on the
    // documented default it was initialised with — the same value the
    // adapter substitutes for a stored value it cannot decode — rather than
    // showing a blank group. Card 95 says so on screen: a group silently
    // showing "Default" when the stored policy could not be read would tell
    // the user their tool calls are gated one way while the gate itself
    // (`ApprovalPolicyGate`, which reads the store independently and fails
    // CLOSED) is behaving another.
    optionsServices()
      .settings.getApprovalPolicy()
      .then(([p, err]) => {
        if (err)
          policyFailure = storageFailureMessage(m.settingsSection_readPolicyFailedWhat(), err);
        else policy = p;
      })
      .finally(() => (policyLoading = false));
    optionsServices()
      .settings.getMcpApprovalPolicy()
      .then(([p, err]) => {
        if (err)
          mcpPolicyFailure = storageFailureMessage(
            m.settingsSection_readMcpPolicyFailedWhat(),
            err,
          );
        else mcpPolicy = p;
      })
      .finally(() => (mcpPolicyLoading = false));

    // Keep this page's radio selection correct if the policy changes from
    // elsewhere while it's open (another options tab, or a value synced in
    // from a different machine on the same profile) rather than only ever
    // reflecting what this tab itself last wrote. Two independent
    // subscriptions (decisions/20) — one can never fire the other's callback.
    unsubscribePolicy = optionsServices().settings.onApprovalPolicyChange((p) => (policy = p));
    unsubscribeMcpPolicy = optionsServices().settings.onMcpApprovalPolicyChange(
      (p) => (mcpPolicy = p),
    );
  });

  onDestroy(() => {
    unsubscribePolicy?.();
    unsubscribeMcpPolicy?.();
  });

  // THE LAST TWO THROWS OF AN EXPECTED FAILURE IN THIS REPO, REMOVED (card
  // 95, decisions/34-errors-as-values.md). Both were `throw err;` after the
  // rollback below, and both were on scripts/throw-allowlist.json marked
  // `migrates: card 95` — the only entries there that never asserted an
  // invariant. What the rethrow actually did was reach the window's unhandled
  // -rejection handler: the radio group's `onValueChange` neither awaits nor
  // catches this promise, so the failure was "reported" to the devtools
  // console of a page the user is not looking at, and the UI's only remaining
  // signal was the selection quietly springing back.
  //
  // The ROLLBACK is the behaviour that must not regress, and it is unchanged:
  // a policy the store did not accept must not be left showing, because this
  // radio is the user's only picture of a security-relevant setting. What is
  // new is that the snap-back now comes with the reason attached, in the
  // section itself.
  async function handlePolicyChange(next: ApprovalPolicy): Promise<void> {
    const previous = policy;
    policy = next; // optimistic
    const [, err] = await optionsServices().settings.setApprovalPolicy(next);
    if (err) {
      policy = previous;
      policyFailure = storageFailureMessage(m.settingsSection_savePolicyFailedWhat(), err);
      return;
    }
    policyFailure = undefined;
  }

  async function handleMcpPolicyChange(next: McpApprovalPolicy): Promise<void> {
    const previous = mcpPolicy;
    mcpPolicy = next; // optimistic
    const [, err] = await optionsServices().settings.setMcpApprovalPolicy(next);
    if (err) {
      mcpPolicy = previous;
      mcpPolicyFailure = storageFailureMessage(m.settingsSection_saveMcpPolicyFailedWhat(), err);
      return;
    }
    mcpPolicyFailure = undefined;
  }
</script>

<!-- Interface language — first, because it changes how every other section on
     this page reads. Card 100; card 105 adds the other nine locales. -->
<section aria-labelledby="language-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="language-heading" class="text-base font-medium tracking-tight">
        {m.settingsLanguageHeading()}
      </h2>
      <Card.Description>{m.settingsLanguageDescription()}</Card.Description>
    </Card.Header>

    <Card.Content>
      <Field.Field>
        <Field.Label for="interface-locale">{m.settingsLanguageLabel()}</Field.Label>
        <Select.Root
          type="single"
          value={currentLocale}
          onValueChange={handleLocaleChange}
        >
          <Select.Trigger id="interface-locale" class="w-full">
            {localeLabel(currentLocale)}
          </Select.Trigger>
          <Select.Content>
            {#each LOCALE_OPTIONS as option (option.value)}
              <Select.Item value={option.value} label={option.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </Field.Field>
    </Card.Content>
  </Card.Root>
</section>

<section aria-labelledby="approval-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="approval-heading" class="text-base font-medium tracking-tight">
        {m.settingsSection_approvalHeading()}
      </h2>
      <Card.Description>
        {m.settingsSection_approvalDescription()}
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      <!-- Card 95: what the two rethrows became. Above the radio group, so a
           selection that sprang back is explained right where it happened. -->
      {#if policyFailure}
        <Alert.Root variant="destructive">
          <Alert.Description>{policyFailure}</Alert.Description>
        </Alert.Root>
      {/if}
      {#if policyLoading}
        <p class="text-sm text-muted-foreground">{m.loadingLabel()}</p>
      {:else}
        <RadioGroup
          value={policy}
          onValueChange={(next) => handlePolicyChange(next as ApprovalPolicy)}
          aria-labelledby="approval-heading"
        >
          {#each POLICY_OPTIONS as option (option.value)}
            <Field.Label
              for={`approval-policy-${option.value}`}
              class={option.danger ? "has-data-checked:border-destructive/40" : undefined}
            >
              <Field.Field orientation="horizontal">
                <RadioGroupItem value={option.value} id={`approval-policy-${option.value}`} />
                <Field.Content>
                  <Field.Title>
                    {option.label}
                    {#if option.danger}<Badge variant="destructive">{m.settingsSection_riskBadge()}</Badge>{/if}
                  </Field.Title>
                  <Field.Description>{option.description}</Field.Description>
                </Field.Content>
              </Field.Field>
            </Field.Label>
          {/each}
        </RadioGroup>

        <!-- Static, developer-authored, no untrusted interpolation —
             {@html} is safe here (card 101's technique 1). -->
        <Alert.Root class="bg-muted/40">
          <Alert.Description>
            {@html m.settingsSection_safetyAnnotationsNotice()}
          </Alert.Description>
        </Alert.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</section>

<section aria-labelledby="mcp-approval-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="mcp-approval-heading" class="text-base font-medium tracking-tight">
        {m.settingsSection_mcpApprovalHeading()}
      </h2>
      <Card.Description>
        {m.settingsSection_mcpApprovalDescription()}
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if mcpPolicyFailure}
        <Alert.Root variant="destructive">
          <Alert.Description>{mcpPolicyFailure}</Alert.Description>
        </Alert.Root>
      {/if}
      {#if mcpPolicyLoading}
        <p class="text-sm text-muted-foreground">{m.loadingLabel()}</p>
      {:else}
        <RadioGroup
          value={mcpPolicy}
          onValueChange={(next) => handleMcpPolicyChange(next as McpApprovalPolicy)}
          aria-labelledby="mcp-approval-heading"
        >
          {#each MCP_POLICY_OPTIONS as option (option.value)}
            <Field.Label
              for={`mcp-approval-policy-${option.value}`}
              class={option.danger ? "has-data-checked:border-destructive/40" : undefined}
            >
              <Field.Field orientation="horizontal">
                <RadioGroupItem value={option.value} id={`mcp-approval-policy-${option.value}`} />
                <Field.Content>
                  <Field.Title>
                    {option.label}
                    {#if option.danger}<Badge variant="destructive">{m.settingsSection_riskBadge()}</Badge>{/if}
                  </Field.Title>
                  <Field.Description>{option.description}</Field.Description>
                </Field.Content>
              </Field.Field>
            </Field.Label>
          {/each}
        </RadioGroup>

        <Alert.Root class="bg-muted/40">
          <Alert.Description>
            {m.settingsSection_mcpSafetyNotice()}
          </Alert.Description>
        </Alert.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</section>
