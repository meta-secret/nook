<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'

  let {
    title,
    subtitle,
    open = false,
    disabled = false,
    testId,
    onToggle,
    badge,
    children,
  }: {
    title: string
    subtitle?: string
    open?: boolean
    disabled?: boolean
    testId?: string
    onToggle?: () => void
    badge?: Snippet
    children?: Snippet
  } = $props()
</script>

<section
  class="overflow-hidden rounded-xl border transition-colors {open
    ? 'border-primary/30 bg-background shadow-sm'
    : 'border-border/60 bg-muted/15'}"
  data-testid={testId}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 border-l-2 px-3.5 py-2.5 text-left transition-colors {open
      ? 'border-l-primary'
      : 'border-l-transparent hover:bg-muted/25'}"
    aria-expanded={open}
    {disabled}
    onclick={() => onToggle?.()}
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
    <div class="border-t border-border/40 px-3.5 pb-3 pt-2">
      {@render children?.()}
    </div>
  {/if}
</section>
