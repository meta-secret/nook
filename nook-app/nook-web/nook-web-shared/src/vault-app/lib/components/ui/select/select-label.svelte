<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    class: className,
    children,
    ...restProps
  }: Omit<WithElementRef<HTMLAttributes<HTMLDivElement>>, "ref"> = $props();
</script>

<div
  data-slot="select-label"
  class={cn("text-muted-foreground px-1.5 py-1 text-xs", className)}
  {...restProps}
>
  {@render children?.()}
</div>
