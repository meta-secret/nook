<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils'

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props()
</script>

<div
  class={cn('grid auto-rows-min grid-rows-[auto_auto] gap-1.5 px-6', className)}
  {...restProps}
>
  {@render children?.()}
</div>
