<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'

  let {
    title,
    subtitle,
    open,
    onToggle,
    disabled = false,
    testId,
    badge,
    children,
  }: {
    title: string
    subtitle?: string
    open: boolean
    onToggle: () => void
    disabled?: boolean
    testId?: string
    badge?: Snippet
    children?: Snippet
  } = $props()
</script>

<section
  class="overflow-hidden transition-colors {open
    ? 'nk-panel'
    : 'border border-border/60 bg-muted/15'}"
  data-testid={testId}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {open
      ? ''
      : 'hover:bg-muted/25'}"
    aria-expanded={open}
    {disabled}
    onclick={onToggle}
  >
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-semibold text-foreground">{title}</span>
      {#if subtitle}
        <span
          class="block text-xs text-muted-foreground {open
            ? 'text-pretty'
            : 'truncate'}"
        >
          {subtitle}
        </span>
      {/if}
    </span>
    {#if badge}
      <span class="shrink-0">{@render badge()}</span>
    {/if}
    <ChevronDown
      class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 {open
        ? 'rotate-180'
        : ''}"
    />
  </button>

  {#if open}
    <div
      class="border-t border-border/60 px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4"
    >
      {@render children?.()}
    </div>
  {/if}
</section>
