<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants'

  type ButtonVariantConfig = {
    readonly base: string
    readonly variants: {
      readonly variant: {
        readonly default: string
        readonly destructive: string
        readonly outline: string
        readonly secondary: string
        readonly ghost: string
        readonly link: string
      }
      readonly size: {
        readonly default: string
        readonly sm: string
        readonly lg: string
        readonly icon: string
      }
    }
    readonly defaultVariants: {
      readonly variant: 'default'
      readonly size: 'default'
    }
  }

  const buttonVariantConfig: ButtonVariantConfig = {
    base: 'ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border-input bg-background hover:bg-accent hover:text-accent-foreground border',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
  export const buttonVariants = tv(buttonVariantConfig)

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']
  export type ButtonSize = VariantProps<typeof buttonVariants>['size']
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
  class={cn((() => { const buttonVariantsArgs: Parameters<typeof buttonVariants>[0] = { variant, size }; return buttonVariants(buttonVariantsArgs); })(), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
