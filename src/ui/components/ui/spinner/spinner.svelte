<script lang="ts">
	import { HugeiconsIcon } from "@hugeicons/svelte"
	import { Loading03Icon } from '@hugeicons/core-free-icons';
	import { cn } from "$lib/utils.js";
	import type { SVGAttributes } from "svelte/elements";

	let {
		class: className,
		role = "status",
		// we add name, color, and stroke for compatibility with different icon libraries props
		name,
		color,
		stroke,
		// LOCAL PATCH (card 65): svelte/elements types the `className` attribute
		// as `string | null | undefined`, HugeiconsIcon's props as
		// `string | undefined`. Left in `restProps` the spread fails to
		// typecheck under our strictNullChecks, so scrub it the same way this
		// file already scrubs name/color/stroke. Re-apply if the kit is
		// regenerated.
		className: classNameProp,
		"aria-label": ariaLabel = "Loading",
		...restProps
	}: SVGAttributes<SVGSVGElement> = $props();
</script>

<HugeiconsIcon icon={Loading03Icon} strokeWidth={2} {role} name={name === null ? undefined : name} color={color === null ? undefined : color} stroke={stroke === null ? undefined : stroke} className={classNameProp === null ? undefined : classNameProp} aria-label={ariaLabel} class={cn("size-4 animate-spin", className)} {...restProps} />
