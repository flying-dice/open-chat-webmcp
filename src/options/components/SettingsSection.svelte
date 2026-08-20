<script lang="ts">
  // Card 13: the two approval policies. Both live in this one component
  // (mounted once from App.svelte, per the comment there) because they're
  // plain preferences rather than anything with its own CRUD flow like
  // ProvidersSection — each gets its own `.section` card from options.css
  // so they read as two settings, not one crowded one.
  //
  // Approval policy (decisions/05-tool-approval-policy.md): stored via
  // src/lib/settings.ts, the typed getter/setter/subscription contract card
  // 09's side-panel approval UI reads to decide whether a given tool call
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
  import { onDestroy, onMount } from "svelte";
  import {
    getApprovalPolicy,
    getMcpApprovalPolicy,
    onApprovalPolicyChange,
    onMcpApprovalPolicyChange,
    setApprovalPolicy,
    setMcpApprovalPolicy,
    type ApprovalPolicy,
    type McpApprovalPolicy,
  } from "../../lib/settings";

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
    getApprovalPolicy()
      .then((p) => (policy = p))
      .finally(() => (policyLoading = false));
    getMcpApprovalPolicy()
      .then((p) => (mcpPolicy = p))
      .finally(() => (mcpPolicyLoading = false));

    // Keep this page's radio selection correct if the policy changes from
    // elsewhere while it's open (another options tab, or a value synced in
    // from a different machine on the same profile) rather than only ever
    // reflecting what this tab itself last wrote. Two independent
    // subscriptions (decisions/20) — one can never fire the other's callback.
    unsubscribePolicy = onApprovalPolicyChange((p) => (policy = p));
    unsubscribeMcpPolicy = onMcpApprovalPolicyChange((p) => (mcpPolicy = p));
  });

  onDestroy(() => {
    unsubscribePolicy?.();
    unsubscribeMcpPolicy?.();
  });

  async function handlePolicyChange(next: ApprovalPolicy): Promise<void> {
    const previous = policy;
    policy = next; // optimistic
    try {
      await setApprovalPolicy(next);
    } catch (err) {
      policy = previous;
      throw err;
    }
  }

  async function handleMcpPolicyChange(next: McpApprovalPolicy): Promise<void> {
    const previous = mcpPolicy;
    mcpPolicy = next; // optimistic
    try {
      await setMcpApprovalPolicy(next);
    } catch (err) {
      mcpPolicy = previous;
      throw err;
    }
  }

</script>

<section class="section" aria-labelledby="approval-heading">
  <div class="section__header">
    <h2 id="approval-heading">Tool approval</h2>
    <p>
      Controls when a tool call from the page's own WebMCP tools runs immediately versus waiting
      for you to approve it first (decisions/05-tool-approval-policy.md).
    </p>
  </div>

  {#if policyLoading}
    <p>Loading…</p>
  {:else}
    <div class="policy-options" role="radiogroup" aria-labelledby="approval-heading">
      {#each POLICY_OPTIONS as option (option.value)}
        <label class="policy-option" class:policy-option--danger={option.danger}>
          <input
            type="radio"
            name="approval-policy"
            value={option.value}
            checked={policy === option.value}
            onchange={() => handlePolicyChange(option.value)}
          />
          <span class="policy-option__body">
            <span class="policy-option__label">
              {option.label}
              {#if option.danger}<span class="badge badge--danger">Risk</span>{/if}
            </span>
            <span class="policy-option__description">{option.description}</span>
          </span>
        </label>
      {/each}
    </div>

    <p class="note">
      Tool safety annotations like <code>readOnlyHint</code> are supplied by the page itself, not
      verified by the extension — a hostile page can label a genuinely destructive tool
      "read-only" to slip it past this policy. This setting is UX guidance for the common case, not
      a security boundary; the actual boundary is which sites you've chosen to open the side panel
      on and grant this extension permission to reach. Every call, auto-run or approved, is still
      recorded in the tool-call log so nothing happens invisibly.
    </p>
  {/if}
</section>

<section class="section" aria-labelledby="mcp-approval-heading">
  <div class="section__header">
    <h2 id="mcp-approval-heading">MCP server tool approval</h2>
    <p>
      A SEPARATE setting from "Tool approval" above (decisions/20-approval-policy-is-per-tool-source.md)
      — controls when a call to one of your configured MCP servers' tools runs immediately versus
      waiting for your approval. Changing the page policy above never affects this one, or the other
      way around.
    </p>
  </div>

  {#if mcpPolicyLoading}
    <p>Loading…</p>
  {:else}
    <div class="policy-options" role="radiogroup" aria-labelledby="mcp-approval-heading">
      {#each MCP_POLICY_OPTIONS as option (option.value)}
        <label class="policy-option" class:policy-option--danger={option.danger}>
          <input
            type="radio"
            name="mcp-approval-policy"
            value={option.value}
            checked={mcpPolicy === option.value}
            onchange={() => handleMcpPolicyChange(option.value)}
          />
          <span class="policy-option__body">
            <span class="policy-option__label">
              {option.label}
              {#if option.danger}<span class="badge badge--danger">Risk</span>{/if}
            </span>
            <span class="policy-option__description">{option.description}</span>
          </span>
        </label>
      {/each}
    </div>

    <p class="note">
      A remote server is not something you're looking at the way you are the current page — you
      have no ambient evidence a call actually was read-only, and its blast radius can be an
      account, a repo, or a ticket queue rather than one tab. That is why this policy defaults to
      "Always confirm" rather than mirroring the page policy's default, and why the two settings are
      kept fully independent. Manage which servers are configured from the MCP Servers section
      below.
    </p>
  {/if}
</section>

<style>
  /* Scoped to this component: options.css is the shared vocabulary for
     every options section, but this component doesn't have write access to
     it (it belongs to card 22's ProvidersSection area). These rules only
     ever reference tokens already declared in src/lib/theme.css — no new
     colours, spacing, or radii, per decisions/08. */

  .policy-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .policy-option {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    border: 1px solid var(--color-outline-variant);
    border-radius: var(--radius-card);
    padding: var(--space-3);
    cursor: pointer;
  }

  .policy-option input[type="radio"] {
    margin-top: 3px;
    flex: none;
  }

  .policy-option--danger {
    border-color: var(--color-danger);
  }

  .policy-option__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .policy-option__label {
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .policy-option__description {
    color: var(--color-on-surface-variant);
    font-size: var(--font-size-small);
  }

</style>
