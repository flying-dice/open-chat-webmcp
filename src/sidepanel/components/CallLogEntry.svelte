<script lang="ts">
  /**
   * One entry in the Call Log (card 11 — the accountability surface,
   * decisions/05-tool-approval-policy.md: "nothing happens invisibly").
   * Reuses ToolArgs.svelte/ToolArgValue.svelte for arguments and results
   * rather than a third renderer, same as ApprovalCard.svelte does for the
   * transcript.
   *
   * Starts expanded for anything a human had to decide on or that didn't
   * simply succeed (`approved`, `denied`, or an error) — the call log is
   * the accountability surface (card 11) and keeps this rule even where
   * card 61's transcript timeline (ActivityGroup.svelte/ToolCallRow.svelte)
   * now defaults its own per-row payload closed and instead expands at the
   * GROUP level for the same cases — because per decisions/05 "a denied call
   * must be as visible as a successful one": a denied entry gets the same
   * danger-coloured treatment a failed one does, never a quieter one.
   * Auto-run successes start collapsed since nobody had to review them.
   *
   * Card 38 (decisions/19 §6): `entry.origin`, recorded alongside args and
   * result by src/domain/chat/session.ts's `logToolCall`, is shown next to
   * the call name — the call log is the accountability surface, so it must
   * say where every logged call ran, not just what it did.
   *
   * Card 69 (decisions/28-shadcn-svelte-maia-zinc.md): re-skinned onto
   * shadcn's Collapsible + Badge + Button. The denied badge keeps its
   * solid-fill treatment (overriding Badge's default tonal `destructive`
   * variant) so it still reads as the most visually prominent state, per
   * decisions/05.
   */
  import { untrack } from "svelte";
  import type { ToolCallLogEntry } from "../../domain/chat";
  import { copyText } from "../../ui/clipboard";
  import { formatTimeOfDay } from "../../ui/datetime";
  import { originLabel } from "../presentation/toolOrigin";
  import { formatDuration } from "../presentation/duration";
  import { noteText } from "../presentation/transcriptNote";
  import ToolArgs from "./ToolArgs.svelte";
  import ToolArgValue from "./ToolArgValue.svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    entry: ToolCallLogEntry;
  }

  let { entry }: Props = $props();

  /**
   * The failure text, card 114 / decisions/38: an outcome the EXTENSION
   * decided (denied, timed out, stopped, an unknown tool name) is stored as a
   * KIND on `entry.errorNote` and worded here, so the inspector says the same
   * thing as the transcript row for the same call — in the reader's language.
   * `entry.error` alone is either the TOOL's own message, kept verbatim, or
   * (for a call logged before this card) our old English prose, rendered
   * as-is: the legacy passthrough, nothing converted.
   */
  const errorText = $derived(
    entry.errorNote ? noteText(entry.errorNote) : (entry.error ?? undefined),
  );

  const status = $derived.by((): "pending" | "success" | "error" => {
    if (entry.endedAt === undefined) return "pending";
    return entry.error !== undefined ? "error" : "success";
  });

  let expanded = $state(
    untrack(
      () => entry.mode !== "auto" || entry.endedAt === undefined || entry.error !== undefined,
    ),
  );

  const modeLabel: Record<ToolCallLogEntry["mode"], string> = {
    auto: m.callLogEntry_modeAuto(),
    approved: m.callLogEntry_modeApproved(),
    denied: m.callLogEntry_modeDenied(),
  };

  const durationLabel = $derived.by(() => {
    if (entry.endedAt === undefined) return m.runningLabel();
    return formatDuration(entry.endedAt - entry.startedAt);
  });

  const timeLabel = $derived(formatTimeOfDay(entry.startedAt));

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyAsJson(): Promise<void> {
    // Card 95: the clipboard's own catch lives in src/ui/clipboard.ts now.
    // A refusal still just means the button doesn't confirm; nothing else
    // depends on it.
    if (!(await copyText(JSON.stringify(entry, null, 2)))) return;
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1200);
  }
</script>

<Collapsible.Root
  bind:open={expanded}
  class={[
    "w-full min-w-0 overflow-hidden rounded-xl border",
    (entry.mode === "denied" || status === "error") && "border-destructive",
  ]
    .filter(Boolean)
    .join(" ")}
>
  <div class="flex w-full flex-wrap items-center gap-2 bg-muted/50 px-2 py-1">
    <!-- Card 115: the trigger's own name is the tool name and its origin —
         the approve/deny mode and the duration sit in the SIBLING span below,
         outside it, so a screen-reader user tabbing the call log heard
         "read-page-state, collapsed, button" and nothing about whether the
         call was denied. Pointing `aria-describedby` at that span borrows the
         wording already on screen rather than composing a second sentence
         (and a second set of message keys) that could drift from it. -->
    <Collapsible.Trigger
      aria-describedby="call-log-status-{entry.id}"
      class="flex min-w-0 flex-1 items-center gap-1 text-start"
    >
      <span
        class="inline-block shrink-0 text-xs text-muted-foreground transition-transform duration-150"
        class:rotate-90={expanded}
        aria-hidden="true">▸</span
      >
      <span class="min-w-0 truncate font-mono text-code" dir="ltr">{entry.name}</span>
      {#if entry.origin}
        <Badge
          variant="outline"
          class={entry.origin.kind === "server" ? "border-primary text-primary" : ""}
          dir="ltr"
        >
          {originLabel(entry.origin)}
        </Badge>
      {/if}
    </Collapsible.Trigger>

    <span id="call-log-status-{entry.id}" class="flex shrink-0 items-center gap-1">
      {#if entry.mode === "denied"}
        <Badge variant="destructive" class="bg-destructive text-white">{modeLabel[entry.mode]}</Badge>
      {:else if entry.mode === "approved"}
        <Badge variant="outline" class="border-primary text-primary">{modeLabel[entry.mode]}</Badge>
      {:else}
        <Badge variant="outline" class="text-muted-foreground">{modeLabel[entry.mode]}</Badge>
      {/if}
      <span class="text-xs whitespace-nowrap text-muted-foreground" title={timeLabel}>{durationLabel}</span>
    </span>

    <Button type="button" variant="ghost" size="xs" onclick={copyAsJson}>
      {copied ? m.copiedLabel() : m.callLogEntry_copyJsonLabel()}
    </Button>
  </div>

  <Collapsible.Content>
    <div class="flex flex-col gap-2 border-t p-2">
      <div>
        <h3 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >{m.argumentsHeading()}</h3
        >
        <ToolArgs args={entry.arguments} />
      </div>

      {#if errorText !== undefined}
        <div>
          <h3 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >{m.errorHeading()}</h3
          >
          <p class="m-0 text-sm break-words whitespace-pre-wrap text-destructive">{errorText}</p>
        </div>
      {:else if entry.result !== undefined}
        <div>
          <h3 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >{m.resultHeading()}</h3
          >
          <ToolArgValue value={entry.result} />
        </div>
      {:else}
        <p class="m-0 text-sm text-muted-foreground italic">{m.callLogEntry_stillRunning()}</p>
      {/if}
    </div>
  </Collapsible.Content>
</Collapsible.Root>
