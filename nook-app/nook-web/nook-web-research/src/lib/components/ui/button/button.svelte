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
  let variantInput: Parameters<typeof buttonVariants>[0] = $derived({
    variant,
    size,
  })
</script>

<button
  class={cn(buttonVariants(variantInput), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
