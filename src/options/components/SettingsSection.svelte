<script lang="ts">
  // Card 13: approval policy + history controls. Two logically distinct
  // settings live in this one component (mounted once from App.svelte, per
  // the comment there) because they're both plain on/off preferences rather
  // than anything with its own CRUD flow like ProvidersSection — each gets
  // its own `.section` card from options.css so they read as two settings,
  // not one crowded one.
  //
  // Approval policy (decisions/05-tool-approval-policy.md): stored via
  // src/lib/settings.ts, the typed getter/setter/subscription contract card
  // 09's side-panel approval UI reads to decide whether a given tool call
  // needs a human's OK. This component only lets the user pick which of the
  // three policies is active — it does not itself judge any tool call.
  //
  // History controls (decisions/13-global-tab-aware-chat-history.md, which
  // revises decisions/07-session-state-and-persistence.md on this point): a
  // clear-all action over src/lib/session.ts's `listChatSummaries` /
  // `clearAllChats`, showing what's actually stored so "Clear all history"
  // isn't a blind destructive button. Chats are global now, not per-tab —
  // this lists every stored chat regardless of which tab or site it
  // happened on (card 34's panel History view is the same list, with an
  // open action this card doesn't need).
  import { onDestroy, onMount } from "svelte";
  import {
    getApprovalPolicy,
    onApprovalPolicyChange,
    setApprovalPolicy,
    type ApprovalPolicy,
  } from "../../lib/settings";
  import { clearAllChats, listChatSummaries, type ChatSummary } from "../../lib/session";

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

  let policy = $state<ApprovalPolicy>("default");
  let policyLoading = $state(true);

  let sessions = $state<ChatSummary[]>([]);
  let sessionsLoading = $state(true);
  let clearingHistory = $state(false);

  let unsubscribePolicy: (() => void) | undefined;

  async function refreshSessions(): Promise<void> {
    sessions = await listChatSummaries();
  }

  onMount(() => {
    getApprovalPolicy()
      .then((p) => (policy = p))
      .finally(() => (policyLoading = false));
    refreshSessions().finally(() => (sessionsLoading = false));

    // Keep this page's radio selection correct if the policy changes from
    // elsewhere while it's open (another options tab, or a value synced in
    // from a different machine on the same profile) rather than only ever
    // reflecting what this tab itself last wrote.
    unsubscribePolicy = onApprovalPolicyChange((p) => (policy = p));
  });

  onDestroy(() => {
    unsubscribePolicy?.();
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

  function formatOrigin(origin: string): string {
    return origin || "(unknown origin)";
  }

  function formatUpdatedAt(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  async function handleClearAll(): Promise<void> {
    if (sessions.length === 0) return;
    const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
    const ok = confirm(
      `Delete all ${sessions.length} stored chat${sessions.length === 1 ? "" : "s"} ` +
        `(${totalMessages} message${totalMessages === 1 ? "" : "s"} total)? ` +
        `This removes every conversation and tool-call log, on every site and every tab. This cannot be undone.`,
    );
    if (!ok) return;

    clearingHistory = true;
    try {
      await clearAllChats();
      sessions = [];
    } finally {
      clearingHistory = false;
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

<section class="section" aria-labelledby="history-heading">
  <div class="section__header">
    <h2 id="history-heading">Chat history</h2>
    <p>
      Every chat is listed here, newest first, no matter which tab or site it happened on — a chat
      is its own thing now, not tied to a tab (decisions/13-global-tab-aware-chat-history.md). Open
      and delete individual chats from the side panel's History view; this page only offers
      clear-all. Provider connections — base URL, API keys, default model — are managed in
      <a href="#providers-heading">Chat providers</a> above.
    </p>
  </div>

  <p class="note">
    Conversation history — including page content and tool-call results from sites you've chatted
    with, even authenticated ones — is stored unencrypted on this device
    (<code>chrome.storage.local</code>). Anyone with access to this browser profile's data can read
    it. Nothing here is synced off the device.
  </p>

  {#if sessionsLoading}
    <p>Loading…</p>
  {:else if sessions.length === 0}
    <div class="empty-state">
      <span class="empty-state__glyph" aria-hidden="true">💬</span>
      <span class="empty-state__title">No stored sessions</span>
      <p>Nothing to clear yet — open the side panel on a WebMCP-capable site to start one.</p>
    </div>
  {:else}
    <div class="session-list">
      {#each sessions as session (session.id)}
        <div class="session-row">
          <span class="session-row__origin">{formatOrigin(session.origin)}</span>
          <span class="session-row__meta">
            {session.messageCount} message{session.messageCount === 1 ? "" : "s"} ·
            {session.toolCallCount} tool call{session.toolCallCount === 1 ? "" : "s"} · updated
            {formatUpdatedAt(session.updatedAt)}
          </span>
        </div>
      {/each}
    </div>

    <div class="toolbar">
      <button type="button" class="btn-danger" onclick={handleClearAll} disabled={clearingHistory}>
        {clearingHistory ? "Clearing…" : `Clear all history (${sessions.length})`}
      </button>
    </div>
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

  .session-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .session-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px solid var(--color-outline-variant);
    border-radius: var(--radius-card);
    padding: var(--space-2) var(--space-3);
  }

  .session-row__origin {
    font-weight: 600;
    word-break: break-all;
  }

  .session-row__meta {
    color: var(--color-on-surface-variant);
    font-size: var(--font-size-small);
  }

  .btn-danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
</style>
