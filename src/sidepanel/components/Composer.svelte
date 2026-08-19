<script lang="ts">
  /**
   * Multiline composer: Enter sends, Shift+Enter inserts a newline, and the
   * send button swaps for a stop button while a message is streaming
   * (card 07 checklist). Sending itself is a stub — it hands the typed text
   * to `onSend` and clears the textarea; wiring that to an actual model call
   * is the card 08/09 agent loop's job, not this shell's.
   *
   * Card 35 (boards/project-backlog/35-force-explicit-model-selection.md):
   * the textarea/send form is replaced entirely by a `blocked` empty state
   * — never just greyed out with no explanation — whenever there's no
   * live, EXPLICITLY chosen provider+model yet. `blocked` is computed here
   * from `selection`/`panel` (the same stores ProviderPicker.svelte and
   * App.svelte already read) rather than threaded down as props, so this
   * stays in sync with the picker without App.svelte having to mirror its
   * state. Four distinct cases, deliberately not collapsed into one banner
   * (card 35's checklist: "does not fight the no-providers-registered
   * empty state" — a user with nothing registered must see THAT, not a
   * "pick a model" prompt for an empty picker):
   *   - `providers-loading` — transient, no action to offer yet.
   *   - `no-providers`/`providers-error` — nothing to pick FROM; routes to
   *     the options page (card 14/23's existing wording), not the picker.
   *   - `unselected` — `resolution.status` is `"none"` or `"dangling"`
   *     (card 23's dangling-provider case counts as unselected per card
   *     35's checklist) — routes to the picker in one click.
   *   - `needs-confirmation` — a selection IS resolved, but only because
   *     `syncToTab` silently seeded it from the stored default
   *     (`!panel.selectionExplicit`, see panel.svelte.ts) — offers a direct
   *     one-click "Use it" via `confirmSelection`, plus a "Change" link
   *     into the picker for anyone who wants something else.
   */
  import { selection, openPicker, confirmSelection, openOptionsPage } from "../stores/selection.svelte";

  interface Props {
    streaming: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
  }

  let { streaming, onSend, onStop }: Props = $props();

  let value = $state("");
  let textarea: HTMLTextAreaElement | undefined = $state();
  let confirming = $state(false);

  type Blocked =
    | { kind: "providers-loading" }
    | { kind: "providers-error" }
    | { kind: "no-providers" }
    | { kind: "unselected"; dangling: boolean }
    | { kind: "needs-confirmation"; label: string };

  // Never blocks mid-stream: the turn already committed to a resolved
  // selection when it started, and yanking the composer away to show a
  // banner while a reply is still streaming would be confusing, not
  // helpful.
  const blocked = $derived.by((): Blocked | undefined => {
    if (streaming) return undefined;
    if (selection.providersStatus === "loading") return { kind: "providers-loading" };
    if (selection.providersStatus === "error") return { kind: "providers-error" };
    if (selection.providers.length === 0) return { kind: "no-providers" };
    if (selection.resolution.status === "none") return { kind: "unselected", dangling: false };
    if (selection.resolution.status === "dangling") return { kind: "unselected", dangling: true };
    if (selection.needsConfirmation && selection.resolution.status === "ok") {
      return {
        kind: "needs-confirmation",
        label: `${selection.resolution.config.name} · ${selection.resolution.model}`,
      };
    }
    return undefined;
  });

  function send(): void {
    const text = value.trim();
    if (!text || streaming || blocked) return;
    onSend(text);
    value = "";
    textarea?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    // isComposing guards IME (e.g. typing Japanese/Chinese) committing its
    // candidate on Enter — that Enter must not also send the message.
    if (event.isComposing) return;
    event.preventDefault();
    send();
  }

  async function handleConfirm(): Promise<void> {
    confirming = true;
    try {
      await confirmSelection();
      textarea?.focus();
    } finally {
      confirming = false;
    }
  }

  /** card 36: let App.svelte put focus here after starting a new chat. */
  export function focusInput(): void {
    textarea?.focus();
  }
</script>

{#if blocked}
  <div class="composer composer--blocked">
    {#if blocked.kind === "providers-loading"}
      <p class="blocked-text text-small">Loading providers…</p>
    {:else if blocked.kind === "providers-error"}
      <p class="blocked-text text-small">Couldn't load your providers.</p>
      <button type="button" onclick={openOptionsPage}>Open options</button>
    {:else if blocked.kind === "no-providers"}
      <p class="blocked-text text-small">
        No provider is registered yet — add one on the options page to start chatting.
      </p>
      <button type="button" onclick={openOptionsPage}>Open options to add a provider</button>
    {:else if blocked.kind === "unselected"}
      <p class="blocked-text text-small">
        {#if blocked.dangling}
          The provider this chat was using has been removed. Choose a replacement to continue —
          your conversation is kept.
        {:else}
          Choose a provider and model before sending your first message.
        {/if}
      </p>
      <button type="button" onclick={openPicker}>Choose provider &amp; model</button>
    {:else if blocked.kind === "needs-confirmation"}
      <p class="blocked-text text-small">This chat will use <strong>{blocked.label}</strong>.</p>
      <div class="blocked-actions">
        <button type="button" disabled={confirming} onclick={handleConfirm}>
          {confirming ? "Confirming…" : `Use ${blocked.label}`}
        </button>
        <button type="button" class="link-btn" onclick={openPicker}>Change</button>
      </div>
    {/if}
  </div>
{:else}
  <form class="composer" onsubmit={(e) => (e.preventDefault(), send())}>
    <textarea
      bind:this={textarea}
      bind:value
      onkeydown={handleKeydown}
      placeholder="Ask about this page… (Enter to send, Shift+Enter for a new line)"
      rows="1"
      disabled={streaming}
    ></textarea>

    {#if streaming}
      <button type="button" class="stop-button" onclick={onStop}> Stop </button>
    {:else}
      <button type="submit" disabled={!value.trim()}> Send </button>
    {/if}
  </form>
{/if}

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     (decisions/08-native-chrome-design-language.md). */

  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-outline);
    background: var(--color-surface);
  }

  textarea {
    flex: 1 1 auto;
    min-width: 0;
    max-height: 8lh;
    field-sizing: content;
  }

  button {
    flex: 0 0 auto;
  }

  .stop-button {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  /* Card 35's blocked-composer empty state: replaces the form entirely, so
     it has to do real work rather than just sit there disabled — a short
     explanation plus a one-click way forward. */
  .composer--blocked {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }

  .blocked-text {
    margin: 0;
    color: var(--color-on-surface-variant);
  }

  .blocked-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .link-btn {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--color-primary);
    font-size: var(--font-size-small);
    flex: 0 0 auto;
  }

  .link-btn:hover {
    background: transparent;
    text-decoration: underline;
  }
</style>
