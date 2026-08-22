<script lang="ts">
  // Chat history controls (decisions/13-global-tab-aware-chat-history.md,
  // which revises decisions/07-session-state-and-persistence.md on this
  // point): a clear-all action over the `ChatStore` port's
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
  //
  // Card 71 (decisions/28-shadcn-svelte-maia-zinc.md): migrated to shadcn
  // components. The one behavioural change is the confirm step — the native
  // `confirm()` is now an `AlertDialog`, which is why `handleClearAll` no
  // longer asks a question and simply performs the delete the dialog's
  // action button already confirmed. Everything the old prompt spelled out
  // (chat count, message count, "cannot be undone") is in the dialog's
  // description instead, so nothing is deleted with less warning than before.
  //
  // Card 100 (decisions/37-i18n-paraglide.md): the "clear all history" button
  // and its confirmation title are this card's PROOF that the pipeline carries
  // more than flat strings — the button takes an interpolated `{count}`, and
  // the title is a plural VARIANT (`countPlural=one` / `=other` in
  // messages/en.json) rather than the `s`-if-not-one ternary it replaces. That
  // ternary is correct English and wrong in most of the ten locales decision
  // 37 names — Russian has three plural forms, Arabic six — which is exactly
  // the class of bug an ICU plural exists to remove. The rest of this
  // component's copy is card 101's.
  import { onMount } from "svelte";
  import type { ChatSummary } from "../../domain/chat";
  import { m } from "../../paraglide/messages.js";
  import { storageFailureMessage } from "../../ui/storageMessage";
  import { optionsServices } from "../app-services";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Alert from "$lib/components/ui/alert";
  import * as Card from "$lib/components/ui/card";
  import * as Empty from "$lib/components/ui/empty";
  import { buttonVariants } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Message01Icon } from "@hugeicons/core-free-icons";

  // TODO: clean-code - 0.35 - NAMING: local state (sessions, sessionsLoading, refreshSessions, loop var session) names a ChatSummary[] "sessions" — the vocabulary decisions/13 and the domain/chat README deliberately retired in favour of "chat". The sibling component rendering the identical type, HistoryPanel.svelte, correctly uses summaries/summary.
  let sessions = $state<ChatSummary[]>([]);
  let sessionsLoading = $state(true);
  let clearingHistory = $state(false);
  /** The AlertDialog replacing the old `confirm()` — closed explicitly once `chats.clearAllChats()` settles so the dialog can't disappear before the work it authorised is done. */
  let confirmOpen = $state(false);

  /** Card 95: this section's error line. One at a time — a failed listing and a failed clear-all cannot both be true of the same click, and the second attempt at either replaces it. */
  let failure = $state<string | undefined>(undefined);

  async function refreshSessions(): Promise<void> {
    const [loaded, err] = await optionsServices().chats.listChatSummaries();
    // Card 92 kept the previous listing on screen rather than blanking it;
    // card 95 says WHY it may be out of date. Blanking would be the worst
    // reading of a failed read on this particular section, whose only button
    // deletes everything it lists.
    if (err) {
      failure = storageFailureMessage("Couldn't load your stored chats", err);
      return;
    }
    failure = undefined;
    sessions = loaded;
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

  let totalMessages = $derived(sessions.reduce((sum, s) => sum + s.messageCount, 0));

  async function handleClearAll(): Promise<void> {
    if (sessions.length === 0) return;
    clearingHistory = true;
    // Card 92: only empty the list when the clear actually landed — showing
    // an empty history for chats that are still in storage would be the worst
    // possible lie for this particular button to tell. Card 95: and say so,
    // because a delete-everything button that appears to do nothing is the
    // other way to lose the user's trust here.
    const [, err] = await optionsServices().chats.clearAllChats();
    if (err) failure = storageFailureMessage("Couldn't clear your chat history", err);
    else {
      failure = undefined;
      sessions = [];
    }
    clearingHistory = false;
    confirmOpen = false;
  }
</script>

<section aria-labelledby="history-heading">
  <Card.Root>
    <Card.Header>
      <h2 id="history-heading" class="text-base font-medium tracking-tight">Chat history</h2>
      <Card.Description>
        Every chat is listed here, newest first, no matter which tab or site it happened on — a chat
        is its own thing now, not tied to a tab (decisions/13-global-tab-aware-chat-history.md). Open
        and delete individual chats from the side panel's History view; this page only offers
        clear-all. Provider connections — base URL, API keys, default model — are managed in
        <a href="#providers-heading" class="underline underline-offset-4">Chat providers</a> above.
      </Card.Description>
    </Card.Header>

    <Card.Content class="flex flex-col gap-4">
      {#if failure}
        <Alert.Root variant="destructive">
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}

      <Alert.Root class="bg-muted/40">
        <Alert.Description>
          Conversation history — including page content and tool-call results from sites you've
          chatted with, even authenticated ones — is stored unencrypted on this device
          (<code class="font-mono text-xs">chrome.storage.local</code>). Anyone with access to this
          browser profile's data can read it. Nothing here is synced off the device.
        </Alert.Description>
      </Alert.Root>

      {#if sessionsLoading}
        <p class="text-sm text-muted-foreground">Loading…</p>
      {:else if sessions.length === 0}
        <Empty.Root class="border p-8">
          <Empty.Header>
            <Empty.Media variant="icon">
              <HugeiconsIcon icon={Message01Icon} strokeWidth={2} />
            </Empty.Media>
            <Empty.Title>No stored sessions</Empty.Title>
            <Empty.Description>
              Nothing to clear yet — open the side panel on a WebMCP-capable site to start one.
            </Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <div class="flex flex-col gap-2">
          {#each sessions as session (session.id)}
            <div class="flex flex-col gap-0.5 rounded-xl border px-3 py-2">
              <span class="font-medium break-all">{formatOrigin(session.origin)}</span>
              <span class="text-xs text-muted-foreground">
                {session.messageCount} message{session.messageCount === 1 ? "" : "s"} ·
                {session.toolCallCount} tool call{session.toolCallCount === 1 ? "" : "s"} · updated
                {formatUpdatedAt(session.updatedAt)}
              </span>
            </div>
          {/each}
        </div>

        <div class="flex justify-end">
          <AlertDialog.Root bind:open={confirmOpen}>
            <AlertDialog.Trigger
              class={buttonVariants({ variant: "destructive" })}
              disabled={clearingHistory}
            >
              {clearingHistory
                ? "Clearing…"
                : m.historyClearAllButton({ count: sessions.length })}
            </AlertDialog.Trigger>
            <AlertDialog.Content>
              <AlertDialog.Header>
                <AlertDialog.Title>
                  {m.historyClearConfirmTitle({ count: sessions.length })}
                </AlertDialog.Title>
                <AlertDialog.Description>
                  That's {totalMessages} message{totalMessages === 1 ? "" : "s"} in total. This
                  removes every conversation and tool-call log, on every site and every tab. This
                  cannot be undone.
                </AlertDialog.Description>
              </AlertDialog.Header>
              <AlertDialog.Footer>
                <AlertDialog.Cancel disabled={clearingHistory}>Cancel</AlertDialog.Cancel>
                <AlertDialog.Action
                  variant="destructive"
                  disabled={clearingHistory}
                  onclick={(event) => {
                    // Keep the dialog open while the delete runs — bits-ui's
                    // Action closes on click by default, which would hide the
                    // "Clearing…" state mid-flight.
                    event.preventDefault();
                    handleClearAll();
                  }}
                >
                  {clearingHistory ? "Clearing…" : "Delete everything"}
                </AlertDialog.Action>
              </AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</section>
