<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

  let {
    class: className,
    ...restProps
  }: Omit<
    WithoutChildrenOrChild<SelectPrimitive.ScrollDownButtonProps>,
    "ref"
  > = $props();
</script>

<SelectPrimitive.ScrollDownButton
  data-slot="select-scroll-down-button"
  class={cn(
    "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4 bottom-0 w-full",
    className,
  )}
  {...restProps}
>
  <ChevronDownIcon />
</SelectPrimitive.ScrollDownButton>
