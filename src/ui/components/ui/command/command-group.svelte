<script lang="ts">
  import { Command as CommandPrimitive, useId } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    heading,
    headingHidden = false,
    value,
    ...restProps
  }: CommandPrimitive.GroupProps & {
    heading?: string;
    /**
     * Card 130 review fix (MR !1, note 12451): a group whose visible
     * disclosure/label already prints its own name on screen (ModelPicker's
     * collapsible Unverified/No-tool-support sections) still needs a real
     * `heading` for `CommandPrimitive.GroupHeading`'s `aria-labelledby`
     * wiring — the group's accessible name and the option's accessible name
     * are independent, and skipping `heading` entirely leaves the group
     * unnamed. Setting this renders that heading `sr-only` instead of the
     * normal visible classes, so the group gets named without a second,
     * visible copy of the label.
     */
    headingHidden?: boolean;
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
		<CommandPrimitive.GroupHeading class={headingHidden ? "sr-only" : "sticky top-0 z-10 bg-popover px-2 py-1 text-xs font-medium text-muted-foreground"}>
			{heading}
		</CommandPrimitive.GroupHeading>
	{/if}
	<!-- Local edit (card 91): bits-ui declares `children?: Snippet`, which under
	     exactOptionalPropertyTypes refuses an explicitly-undefined value. Rendering
	     the snippet inside is equivalent and type-clean. -->
	<CommandPrimitive.GroupItems>{@render children?.()}</CommandPrimitive.GroupItems>
</CommandPrimitive.Group>
