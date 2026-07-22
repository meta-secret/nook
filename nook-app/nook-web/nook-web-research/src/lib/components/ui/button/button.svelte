<script lang="ts" module>
  export type ButtonVariant = 'default' | 'outline' | 'ghost'
  export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

  const BUTTON_BASE =
    'focus-visible:ring-ring inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4'
  const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline:
      'border-input bg-background hover:bg-accent hover:text-accent-foreground border',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
  }
  const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 px-3',
    lg: 'h-11 px-8',
    icon: 'size-10',
  }

  export function buttonVariants({
    variant = 'default',
    size = 'default',
  }: {
    variant?: ButtonVariant
    size?: ButtonSize
  } = {}): string {
    return `${BUTTON_BASE} ${BUTTON_VARIANT_CLASSES[variant]} ${BUTTON_SIZE_CLASSES[size]}`
  }
</script>

<script lang="ts">
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
  class={cn(buttonVariants({ variant, size }), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
