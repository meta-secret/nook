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
</script>

<section
  class="overflow-hidden rounded-xl border transition-colors {disabled
    ? 'border-border/40 bg-muted/10'
    : open
      ? 'border-primary/25 bg-background shadow-sm sm:border-primary/30'
      : 'border-border/50 bg-muted/15 sm:border-border/60'}"
  data-testid={testId}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors {disabled
      ? 'cursor-default'
      : open
        ? 'bg-muted/10'
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
      class="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold {disabled
        ? 'border-border/50 text-muted-foreground'
        : open
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border/70 text-foreground'}"
    >
      {stepNumber}
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
    <div class="space-y-4 border-t border-border/40 px-3.5 py-4">
      {@render children?.()}
    </div>
  {/if}
</section>
