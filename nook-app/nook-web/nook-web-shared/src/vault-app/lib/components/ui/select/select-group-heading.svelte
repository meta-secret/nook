<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import type { ComponentProps } from "svelte";

  let {
    class: className,
    children,
    ...restProps
  }: Omit<
    ComponentProps<typeof SelectPrimitive.GroupHeading>,
    "ref"
  > = $props();
</script>

<SelectPrimitive.GroupHeading
  data-slot="select-group-heading"
  class={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
  {...restProps}
>
  {@render children?.()}
</SelectPrimitive.GroupHeading>
