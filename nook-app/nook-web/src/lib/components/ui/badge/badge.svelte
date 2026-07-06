<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants'

  export const badgeVariants = tv({
    base: 'focus:ring-ring/50 inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus:ring-[3px] focus:outline-hidden [&>svg]:pointer-events-none [&>svg]:size-3',
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus:ring-destructive/20 dark:focus:ring-destructive/40',
        outline:
          'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  })

  export type BadgeVariant = VariantProps<typeof badgeVariants>['variant']
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils'

  let {
    class: className,
    variant = 'default',
    children,
    ...restProps
  }: HTMLAttributes<HTMLSpanElement> & {
    variant?: BadgeVariant
    children?: Snippet
  } = $props()
</script>

<span class={cn(badgeVariants({ variant }), className)} {...restProps}>
  {@render children?.()}
</span>
