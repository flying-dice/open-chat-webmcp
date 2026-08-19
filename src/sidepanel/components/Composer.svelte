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
   *
   * Shape (decisions/18): one outlined, rounded box containing the textarea
   * on top and an action row beneath it — a "+" affordance on the left, the
   * provider/model chip and the send button on the right. The model picker
   * lives HERE rather than in the header because which model answers is a
   * property of the message you are about to send, not of the window.
   */
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";
  import { selection, openPicker, confirmSelection, openOptionsPage } from "../stores/selection.svelte";

  interface Props {
    streaming: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
    /**
     * The provider/model picker, mounted into the action row. A snippet
     * because the picker owns its own open state and anchors its sheet to
     * itself — the composer only decides where in the row it sits.
     */
    picker?: Snippet;
  }

  let { streaming, onSend, onStop, picker }: Props = $props();

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

<form class="composer" data-blocked={blocked !== undefined} onsubmit={(e) => (e.preventDefault(), send())}>
  {#if blocked}
    <!-- Card 35's blocked state: the box stays, and its top half says what
         is missing and offers the one action that fixes it. The action row
         below survives too, because the model chip in it is usually the
         very thing being asked for. -->
    <div class="blocked-body">
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
    <textarea
      bind:this={textarea}
      bind:value
      onkeydown={handleKeydown}
      placeholder="Ask about this page…"
      rows="1"
      disabled={streaming}
      aria-label="Message"
      aria-describedby="composer-hint"
    ></textarea>
    <!-- The Enter/Shift+Enter hint used to live in the placeholder, where it
         pushed the actual prompt off the end of a 320px panel. It is still
         announced, just not drawn. -->
    <p id="composer-hint" class="visually-hidden">
      Press Enter to send, Shift and Enter for a new line.
    </p>
  {/if}

  <!-- The reference has a leading "+" for attachments here. We support
       none, and a permanently disabled button is worse than an absent one —
       same reasoning that kept thumbs up/down out of the reply actions. The
       row is right-aligned until there is something true to put on the
       left. -->
  <div class="composer-actions">
    <div class="composer-actions__end">
      <!-- Rendered in the blocked state too, and not only for symmetry:
           `openPicker` sets `selection.pickerOpen`, which does nothing
           unless a ProviderPicker is actually mounted to read it. The
           blocked state's own "Choose provider & model" button depends on
           this being here. -->
      {#if picker}{@render picker()}{/if}

      {#if streaming}
        <IconButton icon="stop" label="Stop generating" tone="danger" variant="filled" onclick={onStop} />
      {:else if !blocked}
        <IconButton
          icon="arrow_upward"
          label="Send"
          tone="primary"
          variant="filled"
          tooltip={false}
          disabled={!value.trim()}
          onclick={send}
        />
      {/if}
    </div>
  </div>
</form>

<style>
  /* All colour/spacing/radius/motion values come from src/lib/theme.css
     and src/sidepanel/chat-theme.css (decisions/18). */

  .composer {
    display: flex;
    flex-direction: column;
    /* `position: relative` is load-bearing: the model picker's sheet
       anchors to this box (bottom: 100%), and it must escape the
       transcript's scroller, not be clipped by it. */
    position: relative;
    gap: var(--space-1);
    margin: var(--space-2) var(--space-3) var(--space-3);
    padding: var(--space-3) var(--space-2) var(--space-2);
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    flex: none;
  }

  textarea {
    /* The box IS the input; the textarea inside it draws nothing. */
    width: 100%;
    min-width: 0;
    max-height: 8lh;
    padding: 0 var(--space-2);
    border: none;
    background: transparent;
    /* field-sizing is Chrome 123+; max-height and rows="1" are the floor
       for anything older (manifest minimum is 116). */
    field-sizing: content;
  }

  textarea:hover {
    border: none;
  }

  .composer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .composer-actions__end {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
    min-width: 0;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Card 35's blocked-composer state: it has to do real work rather than
     just sit there disabled — a short explanation plus a one-click way
     forward — but it stays inside the composer's own box, so it reads as
     "the composer, currently saying something" rather than as a banner
     that replaced it. */
  .blocked-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-1);
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
