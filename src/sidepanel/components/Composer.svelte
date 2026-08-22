<script lang="ts">
  /**
   * Multiline composer: Enter sends, Shift+Enter inserts a newline, and the
   * send button swaps for a stop button while `busy` is true (card 07
   * checklist, revised by card 60/decisions/26). Sending itself is a stub —
   * it hands the typed text to `onSend` and clears the textarea; wiring that
   * to an actual model call is the card 08/09 agent loop's job, not this
   * shell's.
   *
   * `busy` (renamed from `streaming` by card 60): true whenever a turn is in
   * flight — streaming tokens, running a tool call, or waiting on approval —
   * not just while tokens are landing. Before card 60 this prop was
   * `panel.isStreaming`, which `runLoop` (src/domain/chat/turn.ts) made false for the
   * ENTIRE tool-execution round (it closes the assistant message before
   * running any tool calls) — so the Stop button vanished for exactly the
   * part of a turn most likely to hang (a slow/misbehaving tool, up to the
   * 35s tool timeout) and most in need of it. `panel.isTurnActive`
   * (App.svelte) is what now feeds this prop.
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
   *     (`!panel.selectionExplicit`, see panel.svelte.ts). Says so, and
   *     leaves the confirming to the model chip in the action row below,
   *     which is already showing the same provider/model and already opens
   *     the picker. This state used to carry its own "Use <model>" button
   *     and "Change" link as well; since decisions/18 put the chip inside
   *     the composer, that was the same offer made twice in one box.
   *
   * Shape (decisions/18, re-skinned onto shadcn Textarea/Button by
   * decisions/28): one outlined, rounded box containing the textarea on top
   * and an action row beneath it — a "+" affordance on the left, the
   * provider/model chip and the send button on the right. The model picker
   * lives HERE rather than in the header because which model answers is a
   * property of the message you are about to send, not of the window.
   *
   * This component is only ever mounted directly under ContextChip in
   * App.svelte's composer dock (never standalone), so its top corners are
   * hard-coded square rather than negotiated with a sibling selector — see
   * App.svelte's dock markup, which stacks the two with no gap so the
   * chip's rounded top and this box's rounded bottom read as one unit.
   */
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Button } from "$lib/components/ui/button";
  import { selection, openPicker, openOptionsPage } from "../stores/selection.svelte";
  import { isSelectionUsable } from "../../domain/providers";

  interface Props {
    busy: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
    /**
     * The provider/model picker, mounted into the action row. A snippet
     * because the picker owns its own open state and anchors its sheet to
     * itself — the composer only decides where in the row it sits.
     */
    picker?: Snippet;
  }

  let { busy, onSend, onStop, picker }: Props = $props();

  let value = $state("");
  // Bound to shadcn's Textarea via `bind:ref`, whose `ref` prop is
  // `$bindable(null)` — initializing to `undefined` here throws Svelte's
  // props_invalid_value at mount (bind: to a fallback-having prop can't
  // start out `undefined`), so this has to start `null`, not bare `$state()`.
  let textarea: HTMLTextAreaElement | null = $state(null);

  type Blocked =
    | { kind: "providers-loading" }
    | { kind: "providers-error" }
    | { kind: "no-providers" }
    | { kind: "unselected"; dangling: boolean }
    | { kind: "needs-confirmation"; label: string };

  // Never blocks mid-turn: the turn already committed to a resolved
  // selection when it started, and yanking the composer away to show a
  // banner while a reply is streaming or a tool is running would be
  // confusing, not helpful.
  const blocked = $derived.by((): Blocked | undefined => {
    if (busy) return undefined;
    if (selection.providersStatus === "loading") return { kind: "providers-loading" };
    if (selection.providersStatus === "error") return { kind: "providers-error" };
    if (selection.providers.length === 0) return { kind: "no-providers" };
    const resolution = selection.resolution;
    if (resolution.status === "none") return { kind: "unselected", dangling: false };
    if (resolution.status === "dangling") return { kind: "unselected", dangling: true };
    // `resolution` is already narrowed to `{ status: "ok" }` by the two
    // eliminations above, so `config`/`model` are read out here rather than
    // off `resolution` after the `isSelectionUsable` check below — TS's
    // negative narrowing of that call's own type predicate would otherwise
    // conflict with the narrowing already established above.
    const { config, model } = resolution;
    if (!isSelectionUsable(resolution, selection.needsConfirmation)) {
      return { kind: "needs-confirmation", label: `${config.name} · ${model}` };
    }
    return undefined;
  });

  function send(): void {
    const text = value.trim();
    if (!text || busy || blocked) return;
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

  /** card 36: let App.svelte put focus here after starting a new chat. */
  export function focusInput(): void {
    textarea?.focus();
  }
</script>

<form
  class="relative flex flex-none flex-col gap-1 rounded-2xl rounded-t-none border border-border bg-card px-2 pt-3 pb-2"
  data-blocked={blocked !== undefined}
  onsubmit={(e) => (e.preventDefault(), send())}
>
  {#if blocked}
    <!-- Card 35's blocked state: the box stays, and its top half says what
         is missing and offers the one action that fixes it. The action row
         below survives too, because the model chip in it is usually the
         very thing being asked for. -->
    <div class="flex flex-col items-start gap-2 px-2 pb-1">
      {#if blocked.kind === "providers-loading"}
        <p class="text-sm text-muted-foreground">Loading providers…</p>
      {:else if blocked.kind === "providers-error"}
        <p class="text-sm text-muted-foreground">Couldn't load your providers.</p>
        <Button type="button" variant="secondary" size="sm" onclick={openOptionsPage}>Open options</Button>
      {:else if blocked.kind === "no-providers"}
        <p class="text-sm text-muted-foreground">
          No provider is registered yet — add one on the options page to start chatting.
        </p>
        <Button type="button" variant="secondary" size="sm" onclick={openOptionsPage}>
          Open options to add a provider
        </Button>
      {:else if blocked.kind === "unselected"}
        <p class="text-sm text-muted-foreground">
          {#if blocked.dangling}
            The provider this chat was using has been removed. Choose a replacement to continue —
            your conversation is kept.
          {:else}
            Choose a provider and model before sending your first message.
          {/if}
        </p>
        <Button type="button" variant="secondary" size="sm" onclick={openPicker}>
          Choose provider &amp; model
        </Button>
      {:else if blocked.kind === "needs-confirmation"}
        <p class="text-sm text-muted-foreground">
          This chat will use <strong class="text-foreground">{blocked.label}</strong> — confirm it
          below to start.
        </p>
      {/if}
    </div>
  {:else}
    <Textarea
      bind:ref={textarea}
      bind:value
      onkeydown={handleKeydown}
      placeholder="Ask about this page…"
      rows={1}
      disabled={busy}
      aria-label="Message"
      aria-describedby="composer-hint"
      class="min-h-0 max-h-[8lh] resize-none border-0 bg-transparent p-0 px-2 text-base shadow-none focus-visible:ring-0"
    />
    <!-- The Enter/Shift+Enter hint used to live in the placeholder, where it
         pushed the actual prompt off the end of a 320px panel. It is still
         announced, just not drawn. -->
    <p id="composer-hint" class="sr-only">
      Press Enter to send, Shift and Enter for a new line.
    </p>
  {/if}

  <!-- The reference has a leading "+" for attachments here. We support
       none, and a permanently disabled button is worse than an absent one —
       same reasoning that kept thumbs up/down out of the reply actions. The
       row is right-aligned until there is something true to put on the
       left. -->
  <div class="flex items-center gap-2">
    <div class="ml-auto flex min-w-0 items-center gap-2">
      <!-- Rendered in the blocked state too, and not only for symmetry:
           `openPicker` sets `selection.pickerOpen`, which does nothing
           unless a ProviderPicker is actually mounted to read it. The
           blocked state's own "Choose provider & model" button depends on
           this being here. -->
      {#if picker}{@render picker()}{/if}

      {#if busy}
        <IconButton
          icon="stop"
          label="Stop generating"
          tone="danger"
          variant="filled"
          size="compact"
          onclick={onStop}
        />
      {:else if !blocked}
        <IconButton
          icon="arrow_upward"
          label="Send"
          tone="primary"
          variant="filled"
          size="compact"
          tooltip={false}
          disabled={!value.trim()}
          onclick={send}
        />
      {/if}
    </div>
  </div>
</form>
