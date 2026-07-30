<script lang="ts">
  import { Separator as SeparatorPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    class: className,
    "data-slot": dataSlot = "separator",
    ...restProps
  }: Omit<SeparatorPrimitive.RootProps, "ref"> = $props();
</script>

<SeparatorPrimitive.Root
  data-slot={dataSlot}
  class={cn(
    "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
    // this is different in shadcn/ui but self-stretch breaks things for us
    "data-[orientation=vertical]:h-full",
    className,
  )}
  {...restProps}
/>
