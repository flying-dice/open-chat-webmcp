<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

  let {
    ref = $bindable(null),
    // Local edit (card 91): defaulted to "" rather than left undefined —
    // bits-ui declares `value?: string`, which under exactOptionalPropertyTypes
    // refuses `string | undefined` (and blows the prop union past TS's
    // representable-type limit while doing so).
    value = $bindable(""),
    ...restProps
  }: DropdownMenuPrimitive.RadioGroupProps = $props();
</script>

<DropdownMenuPrimitive.RadioGroup
	bind:ref
	bind:value
	data-slot="dropdown-menu-radio-group"
	{...restProps}
/>
