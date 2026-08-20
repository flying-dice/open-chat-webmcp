<script lang="ts">
  // Chat history controls (decisions/13-global-tab-aware-chat-history.md,
  // which revises decisions/07-session-state-and-persistence.md on this
  // point): a clear-all action over src/lib/session.ts's
  // `listChatSummaries` / `clearAllChats`, showing what's actually stored
  // so "Clear all history" isn't a blind destructive button. Chats are
  // global now, not per-tab — this lists every stored chat regardless of
  // which tab or site it happened on (card 34's panel History view is the
  // same list, with an open action this page doesn't need).
  //
  // Split out of SettingsSection.svelte so it can sit BELOW the MCP servers
  // registry in App.svelte's order: the page now reads configuration first
  // (providers, approval policies, MCP servers) and stored data last, which
  // is also the order of how destructive each section is.
  import { onMount } from "svelte";
  import { clearAllChats, listChatSummaries, type ChatSummary } from "../../lib/session";

  let sessions = $state<ChatSummary[]>([]);
  let sessionsLoading = $state(true);
  let clearingHistory = $state(false);

  async function refreshSessions(): Promise<void> {
    sessions = await listChatSummaries();
  }

  onMount(() => {
    refreshSessions().finally(() => (sessionsLoading = false));
  });

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
     every options section. These rules only ever reference tokens already
     declared in src/lib/theme.css — no new colours, spacing, or radii, per
     decisions/08. */

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
