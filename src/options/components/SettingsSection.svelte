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
  import { onDestroy, onMount } from "svelte";
  import type { ApprovalPolicy, McpApprovalPolicy } from "../../domain/settings";
  import { optionsServices } from "../app-services";
  import * as Alert from "$lib/components/ui/alert";
  import * as Card from "$lib/components/ui/card";
  import * as Field from "$lib/components/ui/field";
  import { Badge } from "$lib/components/ui/badge";
  import { RadioGroup, RadioGroupItem } from "$lib/components/ui/radio-group";

  const POLICY_OPTIONS: {
    value: ApprovalPolicy;
    label: string;
    description: string;
    danger?: boolean;
  }[] = [
    {
      value: "default",
      label: "Default (recommended)",
      description:
        "Tools the page marks readOnlyHint: true run automatically, shown as a collapsed card in the chat. Every other tool call — including ones with no annotation at all — waits for you to approve it before it runs.",
    },
    {
      value: "always-confirm",
      label: "Always confirm",
      description:
        "Every tool call waits for your approval, even ones the page marks read-only. Slower, but nothing runs without you seeing it first.",
    },
    {
      value: "auto-run-all",
      label: "Auto-run everything",
      description:
        "Every tool call runs immediately, with no approval step at all — including calls that submit forms, delete data, send messages, or otherwise change a live, logged-in site. The model can act on your behalf and you get no chance to review a call before it happens. Only choose this if you fully trust both the model you're chatting with and every site you open the side panel on.",
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
      label: "Always confirm (recommended, default)",
      description:
        "Every MCP server tool call waits for your approval, regardless of what the server itself claims about being read-only. A remote service's self-report isn't something you can see the effect of the way you can a page, so this is the strictest of the three options here — deliberately stricter than the page policy's default above.",
    },
    {
      value: "trust-read-only",
      label: "Trust read-only servers",
      description:
        "Tools an MCP server marks readOnlyHint: true run automatically, shown as a collapsed card in the chat, same as the page policy's default. Only choose this for servers you trust to report that hint honestly — it's a claim the server makes about itself, not something this extension verifies.",
    },
    {
      value: "auto-run-all",
      label: "Auto-run everything",
      description:
        "Every MCP server tool call runs immediately, no approval step at all — including calls that modify or delete data on a service authenticated as you, invisibly to whatever you're currently looking at. Only choose this if you fully trust every server you've added below.",
      danger: true,
    },
  ];

  let policy = $state<ApprovalPolicy>("default");
  let policyLoading = $state(true);

  let mcpPolicy = $state<McpApprovalPolicy>("always-confirm");
  let mcpPolicyLoading = $state(true);

  let unsubscribePolicy: (() => void) | undefined;
  let unsubscribeMcpPolicy: (() => void) | undefined;

  onMount(() => {
    optionsServices().settings.getApprovalPolicy()
      .then((p) => (policy = p))
      .finally(() => (policyLoading = false));
    optionsServices().settings.getMcpApprovalPolicy()
      .then((p) => (mcpPolicy = p))
      .finally(() => (mcpPolicyLoading = false));

    // Keep this page's radio selection correct if the policy changes from
    // elsewhere while it's open (another options tab, or a value synced in
    // from a different machine on the same profile) rather than only ever
    // reflecting what this tab itself last wrote. Two independent
    // subscriptions (decisions/20) — one can never fire the other's callback.
    unsubscribePolicy = optionsServices().settings.onApprovalPolicyChange((p) => (policy = p));
    unsubscribeMcpPolicy = optionsServices().settings.onMcpApprovalPolicyChange((p) => (mcpPolicy = p));
  });

  onDestroy(() => {
    unsubscribePolicy?.();
    unsubscribeMcpPolicy?.();
  });

  async function handlePolicyChange(next: ApprovalPolicy): Promise<void> {
    const previous = policy;
    policy = next; // optimistic
    try {
      await optionsServices().settings.setApprovalPolicy(next);
    } catch (err) {
      policy = previous;
      throw err;
    }
  }

  async function handleMcpPolicyChange(next: McpApprovalPolicy): Promise<void> {
    const previous = mcpPolicy;
    mcpPolicy = next; // optimistic
    try {
      await optionsServices().settings.setMcpApprovalPolicy(next);
    } catch (err) {
      mcpPolicy = previous;
      throw err;
    }
  }
</script>

<section aria-labelledby="approval-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="approval-heading" class="text-base font-medium">Tool approval</h2>
      <Card.Description>
        Controls when a tool call from the page's own WebMCP tools runs immediately versus waiting
        for you to approve it first (decisions/05-tool-approval-policy.md).
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if policyLoading}
        <p class="text-sm text-muted-foreground">Loading…</p>
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
                    {#if option.danger}<Badge variant="destructive">Risk</Badge>{/if}
                  </Field.Title>
                  <Field.Description>{option.description}</Field.Description>
                </Field.Content>
              </Field.Field>
            </Field.Label>
          {/each}
        </RadioGroup>

        <Alert.Root class="bg-muted/40">
          <Alert.Description>
            Tool safety annotations like <code class="font-mono text-xs">readOnlyHint</code> are
            supplied by the page itself, not verified by the extension — a hostile page can label a
            genuinely destructive tool "read-only" to slip it past this policy. This setting is UX
            guidance for the common case, not a security boundary; the actual boundary is which
            sites you've chosen to open the side panel on and grant this extension permission to
            reach. Every call, auto-run or approved, is still recorded in the tool-call log so
            nothing happens invisibly.
          </Alert.Description>
        </Alert.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</section>

<section aria-labelledby="mcp-approval-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="mcp-approval-heading" class="text-base font-medium">MCP server tool approval</h2>
      <Card.Description>
        A SEPARATE setting from "Tool approval" above
        (decisions/20-approval-policy-is-per-tool-source.md) — controls when a call to one of your
        configured MCP servers' tools runs immediately versus waiting for your approval. Changing
        the page policy above never affects this one, or the other way around.
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if mcpPolicyLoading}
        <p class="text-sm text-muted-foreground">Loading…</p>
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
                    {#if option.danger}<Badge variant="destructive">Risk</Badge>{/if}
                  </Field.Title>
                  <Field.Description>{option.description}</Field.Description>
                </Field.Content>
              </Field.Field>
            </Field.Label>
          {/each}
        </RadioGroup>

        <Alert.Root class="bg-muted/40">
          <Alert.Description>
            A remote server is not something you're looking at the way you are the current page —
            you have no ambient evidence a call actually was read-only, and its blast radius can be
            an account, a repo, or a ticket queue rather than one tab. That is why this policy
            defaults to "Always confirm" rather than mirroring the page policy's default, and why
            the two settings are kept fully independent. Manage which servers are configured from
            the MCP Servers section below.
          </Alert.Description>
        </Alert.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</section>
