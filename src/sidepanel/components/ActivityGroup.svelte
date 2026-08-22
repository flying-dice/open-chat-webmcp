<script lang="ts">
  /**
   * The timeline for one activity group (card 61): a summary trigger plus a
   * rail of `ToolCallRow`s. Deliberately NOT a filled card — it sits on the
   * panel surface exactly like the assistant's bare-text prose turn
   * (decisions/18); the rail is its only structure.
   *
   * Expansion default (decisions/26):
   *   - live (this group is the transcript's currently in-flight one) →
   *     expanded, so a running call is visible as it happens.
   *   - the reply lands → `live` goes false → it collapses automatically.
   *   - an error or a denied call anywhere in the group → stays expanded
   *     regardless of `live` (a group must never hide that something needs
   *     attention behind one click).
   *   - one user click pins whichever state the user chose, overriding the
   *     auto behaviour for the rest of this component instance's lifetime.
   *
   * This is deliberately NOT `ToolCallCard.svelte`'s old
   * `untrack(() => message.toolMode !== "auto")` pattern (that file,
   * ~:47-51): that default was read ONCE at mount and never meant to
   * change again — a call's approval mode is fixed for its lifetime. A
   * group's default DOES change over time (live → done is exactly the
   * transition that matters here), so the default itself has to stay
   * reactive; only the user's OWN override needs to be sticky, which is
   * what `userToggled`/`userExpanded` capture below without any `$effect`.
   *
   * Card 67 (decisions/28-shadcn-svelte-maia-zinc.md): re-skinned onto
   * shadcn's Collapsible. `expanded` stays the single source of truth for
   * open/closed (passed to `Collapsible.Root` as a plain, non-bound `open`
   * prop — the same controlled pattern OverflowMenu.svelte's DropdownMenu
   * already uses); `onOpenChange` is the only thing that ever writes
   * `userToggled`/`userExpanded`, replacing the old manual `toggle()`.
   */
  import { summariseActivity, type TranscriptEntry } from "../../domain/chat";
  import ToolCallRow from "./ToolCallRow.svelte";
  import Icon from "./Icon.svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { cn } from "$lib/utils";
  import { m } from "../../paraglide/messages.js";

  interface Props {
    steps: TranscriptEntry[];
    live: boolean;
  }

  let { steps, live }: Props = $props();

  let userToggled = $state(false);
  let userExpanded = $state(false);

  const summary = $derived(summariseActivity(steps));
  const autoOpen = $derived(live || summary.needsAttention);
  const expanded = $derived(userToggled ? userExpanded : autoOpen);

  function handleOpenChange(open: boolean): void {
    userExpanded = open;
    userToggled = true;
  }

  /**
   * Collapsed summary text — a `·`-joined line of plain facts, never an
   * invented verb (decisions/26). Must never hide that a remote server was
   * called or that a human approved/denied something (decisions/05,
   * decisions/19 §6), so `via <server>` and the approved/denied counts are
   * part of the collapsed row itself, not only visible once expanded.
   */
  const summaryText = $derived.by((): string => {
    const parts: string[] = [m.activityGroup_stepCount({ count: summary.stepCount })];
    if (summary.namesLabel) parts.push(summary.namesLabel);
    if (summary.serverNames.length > 0)
      parts.push(m.activityGroup_viaServers({ servers: summary.serverNames.join(", ") }));
    if (summary.errorCount > 0)
      parts.push(m.activityGroup_failedCount({ count: summary.errorCount }));
    if (summary.deniedCount > 0)
      parts.push(m.activityGroup_deniedCount({ count: summary.deniedCount }));
    if (summary.approvedCount > 0)
      parts.push(m.activityGroup_approvedCount({ count: summary.approvedCount }));
    return parts.join(" · ");
  });
</script>

<!-- TODO: clean-code - 0.2 - COUPLING: `activity-group`/`summary` (like ProviderPicker.svelte's `picker__trigger`) are classes with no styling of their own kept only so scripts/verify/checks/screenshots.mjs can find them — a magic-string contract with no compiler behind it. -->
<!-- `activity-group`/`summary` class names carry no styling of their own —
     kept purely so verify/checks/screenshots.mjs's `.activity-group
     .summary` locator (its activity-timeline screenshots, predating
     accessible-name-based lookups) keeps finding this row rather than
     silently skipping those shots. -->
<Collapsible.Root open={expanded} onOpenChange={handleOpenChange} class="activity-group w-full min-w-0">
  <Collapsible.Trigger
    class="summary group flex w-full min-w-0 items-center gap-2 py-1 text-start text-xs text-muted-foreground"
  >
    <span class="inline-flex flex-none" aria-hidden="true"><Icon name="build" class="size-4" /></span>
    <span class="min-w-0 flex-1 truncate group-hover:underline">{summaryText}</span>
    <!-- NOT mirrored under RTL (card 104's icon audit): a rotate-driven
         disclosure triangle, same reasoning as ToolCallRow.svelte's — its
         orientation is fully described by `expanded`, and that pairing has
         to stay the same in both directions. -->
    <span
      class={cn("inline-flex flex-none transition-transform duration-150", expanded && "rotate-90")}
      aria-hidden="true"
    >
      <Icon name="chevron_right" class="size-4" />
    </span>
  </Collapsible.Trigger>

  <Collapsible.Content>
    <!-- Rail budget: at a 320px panel the transcript content is 288px; this
         costs roughly 20px (12px dot column + a 0.5rem gap). The connecting
         line is a `before:` pseudo-element rather than a real element so it
         costs no extra DOM node, same as the old `.timeline::before`. -->
    <ol
      class="relative mt-2 flex flex-col gap-2 before:absolute before:top-2.5 before:bottom-2.5 before:start-[5px] before:w-0.5 before:rounded-full before:bg-border before:content-['']"
    >
      {#each steps as step (step.id)}
        <ToolCallRow message={step} {live} />
      {/each}
    </ol>
  </Collapsible.Content>
</Collapsible.Root>
