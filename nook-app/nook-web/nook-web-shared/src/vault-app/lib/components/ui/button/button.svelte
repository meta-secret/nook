<script lang="ts">
  import {
    buttonVariants,
    type ButtonSize,
    type ButtonVariant,
  } from './button-variants'
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils'

  let {
    class: className,
    variant = 'default',
    size = 'default',
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
  class={cn((() => { const buttonVariantsArgs: Parameters<typeof buttonVariants>[0] = { variant, size }; return buttonVariants(buttonVariantsArgs); })(), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
