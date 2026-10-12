<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils'
  import { FrameElement, FrameShape, FrameShapeClass } from './frame-state'

  let {
    shape = FrameShape.Dialog,
    element = FrameElement.Div,
    class: className,
    children,
    ...restProps
  }: HTMLAttributes<HTMLElement> & {
    shape?: FrameShape
    element?: FrameElement
    children?: Snippet
  } = $props()

  const shapeClass = $derived(new FrameShapeClass(shape).name)
</script>

<svelte:element this={element} class={cn(shapeClass, className)} {...restProps}>
  {@render children?.()}
</svelte:element>
