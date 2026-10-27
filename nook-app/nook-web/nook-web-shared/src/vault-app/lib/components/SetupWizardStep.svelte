<!--
One step of a provider setup wizard: a square panel with a mono step index.
The open step is the panel the user acts in, so it carries the heavy left
edge (nk-panel); closed and unavailable steps stay flat.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'

  let {
    stepNumber,
    title,
    subtitle,
    disabled = false,
    open = $bindable(false),
    testId,
    children,
  }: {
    stepNumber: number
    title: string
    subtitle: string
    disabled?: boolean
    open?: boolean
    testId?: string
    children?: Snippet
  } = $props()

  const stepIndex = $derived(String(stepNumber).padStart(2, '0'))
</script>

<section
  class="overflow-hidden transition-colors {disabled
    ? 'border border-border/40 bg-muted/10'
    : open
      ? 'nk-panel'
      : 'border border-border/60 bg-muted/15'}"
  data-testid={testId}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {disabled
      ? 'cursor-default'
      : open
        ? ''
        : 'hover:bg-muted/25'}"
    {disabled}
    aria-expanded={open && !disabled}
    onclick={() => {
      if (!disabled) {
        open = !open
      }
    }}
  >
    <span
      class="nk-step-index w-6 shrink-0 {open && !disabled
        ? 'text-foreground'
        : ''}"
    >
      {stepIndex}
    </span>
    <span class="min-w-0 flex-1">
      <span
        class="block text-sm font-semibold {disabled
          ? 'text-muted-foreground'
          : 'text-foreground'}"
      >
        {title}
      </span>
      <span class="block truncate text-xs text-muted-foreground"
        >{subtitle}</span
      >
    </span>
    {#if !disabled}
      <ChevronDown
        class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 {open
          ? 'rotate-180'
          : ''}"
      />
    {/if}
  </button>

  {#if open && !disabled}
    <div class="space-y-4 border-t border-border/60 px-4 py-4">
      {@render children?.()}
    </div>
  {/if}
</section>
