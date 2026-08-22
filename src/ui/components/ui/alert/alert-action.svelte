<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!-- Local edit (card 108): `right-3`→`end-3` — paired with alert.svelte's
     `pe-18` reserved gutter; under RTL the trailing control must sit on the
     end edge, not always the physical right. -->
<div
	bind:this={ref}
	data-slot="alert-action"
	class={cn("absolute top-2.5 end-3", className)}
	{...restProps}
>
	{@render children?.()}
</div>
