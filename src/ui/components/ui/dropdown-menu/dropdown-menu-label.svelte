<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    inset?: boolean;
  } = $props();
</script>

<!-- Local edit (card 108): `data-inset:pl-9.5`→`data-inset:ps-9.5` and
     `data-[inset]:pl-8`→`data-[inset]:ps-8`, matching the item/sub-trigger fix. -->
<div
	bind:this={ref}
	data-slot="dropdown-menu-label"
	data-inset={inset}
	class={cn("px-3 py-2.5 text-xs text-muted-foreground data-inset:ps-9.5 data-[inset]:ps-8", className)}
	{...restProps}
>
	{@render children?.()}
</div>
