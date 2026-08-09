<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils'
  import { ButtonSize, ButtonVariant, buttonVariants } from './button-state'

  let {
    class: className,
    variant = ButtonVariant.Default,
    size = ButtonSize.Default,
    type = 'button',
    children,
    ...restProps
  }: HTMLButtonAttributes & {
    variant?: ButtonVariant
    size?: ButtonSize
    children?: Snippet
  } = $props()
</script>

<button
  class={cn(buttonVariants({ variant, size }), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
