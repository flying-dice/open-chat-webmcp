<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    children,
    ...restProps
  }: DropdownMenuPrimitive.SubTriggerProps & {
    inset?: boolean;
  } = $props();
</script>

<!-- Local edit (card 108): `data-inset:pl-9.5`→`data-inset:ps-9.5`,
     `data-[inset]:pl-8`→`data-[inset]:ps-8`, and the trailing arrow's
     `ml-auto`→`ms-auto` — the inset gutter and the arrow's own margin
     stayed physical under RTL (the arrow glyph itself is a separate,
     unpatched concern: bits-ui's fixed `ArrowRight01Icon` still points the
     same way regardless of direction). -->
<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	class={cn(
		"gap-2 rounded-xl px-3 py-2 text-sm focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:ps-9.5 data-open:bg-accent data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 flex cursor-default items-center outline-hidden select-none data-[inset]:ps-8 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} class="ms-auto" />
</DropdownMenuPrimitive.SubTrigger>
