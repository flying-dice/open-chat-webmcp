<script lang="ts">
  import { Command as CommandPrimitive, useId } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    heading,
    headingId,
    value,
    ...restProps
  }: CommandPrimitive.GroupProps & {
    heading?: string;
    /**
     * Code-review fix on card 130: bits-ui only wires `Command.GroupItems`'
     * (the `role="group"` element) `aria-labelledby` to a heading rendered
     * through the `heading` prop above (`CommandPrimitive.GroupHeading`
     * sets `group.headingNode` via `attachRef`, see command.svelte.js's
     * `CommandGroupHeadingState`/`CommandGroupItemsState`). A consumer that
     * needs an INTERACTIVE heading — e.g. ModelPicker.svelte's collapsible
     * disclosure button, rendered as a `children` sibling instead — never
     * triggers that wiring, so the group got no accessible name at all.
     * `headingId` lets such a consumer point `aria-labelledby` straight at
     * its own external heading element's id. `mergeProps`' plain-key rule
     * (svelte-toolbelt: `b !== undefined ? b : a`) means bits-ui's own
     * computed `aria-labelledby` still wins whenever a real `heading` prop
     * is also passed, so this never fights the built-in case.
     */
    headingId?: string;
  } = $props();
</script>

<!-- Local edit (card 130): `overflow-hidden`→`overflow-visible`, plus
     `shrink-0`. Each Group here is a flex ITEM of ModelPicker.svelte's
     scrollable Command.List (`flex flex-col`, decisions/22's amendment).
     Without `shrink-0`, a Group's own automatic minimum size collapsed
     below its rows' content height — the SAME flexbox "automatic minimum
     size" bug the amendment fixed on Command.Root/List, recurring one
     level deeper — so a big bucket (e.g. Unverified) got silently
     compressed/overlapped instead of genuinely overflowing the list for
     `overflow-y-auto` to scroll. Confirmed live in Storybook: `scrollHeight`
     stayed equal to `clientHeight` (no scrollable area at all) until this
     was added. `overflow-hidden` on the Group itself also made IT the
     nearest scroll container for the sticky heading below (CSS sticky
     positions relative to the nearest ancestor scroll container, and
     `overflow: hidden` counts as one even though nothing here scrolls it) —
     pinning the heading inside the Group's own, static box instead of
     sticking to Command.List's actual scrolled viewport. `overflow-visible`
     lets the heading stick to the real scroll region instead. -->
<CommandPrimitive.Group
	bind:ref
	data-slot="command-group"
	class={cn("shrink-0 overflow-visible p-1 text-foreground **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground", className)}
	value={value ?? heading ?? `----${useId()}`}
	{...restProps}
>
	{#if heading}
		<!-- Local edit (card 130): sticky + bg-popover so a heading (e.g.
		     "Unverified") stays visible while its own section scrolls, then
		     scrolls off with it as the next section arrives — one scroll
		     region (Command.List), not a second independent one. Padding
		     tightened py-1.5→py-1 as part of the same card's density pass. -->
		<CommandPrimitive.GroupHeading class="sticky top-0 z-10 bg-popover px-2 py-1 text-xs font-medium text-muted-foreground">
			{heading}
		</CommandPrimitive.GroupHeading>
	{/if}
	<!-- Local edit (card 91): bits-ui declares `children?: Snippet`, which under
	     exactOptionalPropertyTypes refuses an explicitly-undefined value. Rendering
	     the snippet inside is equivalent and type-clean. -->
	<CommandPrimitive.GroupItems aria-labelledby={headingId}>{@render children?.()}</CommandPrimitive.GroupItems>
</CommandPrimitive.Group>
