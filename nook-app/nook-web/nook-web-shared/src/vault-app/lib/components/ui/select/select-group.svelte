<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    class: className,
    ...restProps
  }: Omit<SelectPrimitive.GroupProps, "ref"> = $props();
</script>

<SelectPrimitive.Group
  data-slot="select-group"
  class={cn("scroll-my-1 p-1", className)}
  {...restProps}
/>
