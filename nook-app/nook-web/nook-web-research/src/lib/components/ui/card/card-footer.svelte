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

<div data-slot="card-footer" class={cn('flex items-center px-6', className)} {...restProps}>
  {@render children?.()}
</div>
