<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils'

  let {
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLParagraphElement> & { children?: Snippet } = $props()
</script>

<p
  class={cn('text-muted-foreground text-sm leading-relaxed', className)}
  {...restProps}
>
  {@render children?.()}
</p>
