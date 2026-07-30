<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
  import ChevronUpIcon from "@lucide/svelte/icons/chevron-up";

  let {
    class: className,
    ...restProps
  }: Omit<
    WithoutChildrenOrChild<SelectPrimitive.ScrollUpButtonProps>,
    "ref"
  > = $props();
</script>

<SelectPrimitive.ScrollUpButton
  data-slot="select-scroll-up-button"
  class={cn(
    "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4 top-0 w-full",
    className,
  )}
  {...restProps}
>
  <ChevronUpIcon />
</SelectPrimitive.ScrollUpButton>
