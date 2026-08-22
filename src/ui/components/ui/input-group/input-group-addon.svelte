<script lang="ts" module>
  import { tv, type VariantProps } from "tailwind-variants";
  // Local edit (card 108): both `align` variants already name the LOGICAL
  // side (`inline-start`/`inline-end`) but paired it with physical CSS
  // (`pl`/`ml-`, `pr`/`mr-`) — swapped for `ps`/`ms-` and `pe`/`me-` so the
  // addon actually lands on the side its own name says under RTL.
  export const inputGroupAddonVariants = tv({
    base: "h-auto gap-2 py-2 text-sm font-medium text-muted-foreground group-data-[disabled=true]/input-group:opacity-50 **:data-[slot=kbd]:rounded-4xl **:data-[slot=kbd]:bg-muted-foreground/10 **:data-[slot=kbd]:px-1.5 [&>svg:not([class*='size-'])]:size-4 flex cursor-text items-center justify-center select-none",
    variants: {
      align: {
        "inline-start": "ps-3 has-[>button]:-ms-1 has-[>kbd]:ms-[-0.15rem] order-first",
        "inline-end": "pe-3 has-[>button]:-me-1 has-[>kbd]:me-[-0.15rem] order-last",
        "block-start":
          "px-3 pt-3 group-has-[>input]/input-group:pt-3 [.border-b]:pb-3 order-first w-full justify-start",
        "block-end":
          "px-3 pb-3 group-has-[>input]/input-group:pb-3 [.border-t]:pt-3 order-last w-full justify-start",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  });

  export type InputGroupAddonAlign = VariantProps<typeof inputGroupAddonVariants>["align"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		align = "inline-start",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		align?: InputGroupAddonAlign;
	} = $props();
</script>

<div
	bind:this={ref}
	role="group"
	data-slot="input-group-addon"
	data-align={align}
	class={cn(inputGroupAddonVariants({ align }), className)}
	onclick={(e) => {
		if ((e.target as HTMLElement).closest("button")) {
			return;
		}
		e.currentTarget.parentElement?.querySelector("input")?.focus();
	}}
	{...restProps}
>
	{@render children?.()}
</div>
