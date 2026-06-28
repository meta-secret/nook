<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'

  let {
    title,
    subtitle,
    section,
    activeSection = $bindable(null as string | null),
    disabled = false,
    testId,
    badge,
    children,
  }: {
    title: string
    subtitle?: string
    section: string
    activeSection?: string | null
    disabled?: boolean
    testId?: string
    badge?: Snippet
    children?: Snippet
  } = $props()

  const open = $derived(activeSection === section)

  function handleToggle() {
    activeSection = open ? null : section
  }
</script>

<section
  class="overflow-hidden rounded-xl border transition-colors {open
    ? 'border-primary/25 bg-background shadow-sm sm:border-primary/30'
    : 'border-border/35 bg-muted/15 sm:border-border/60'}"
  data-testid={testId}
>
  <button
    type="button"
    class="flex w-full items-center gap-3 border-l-2 px-3.5 py-2.5 text-left transition-colors {open
      ? 'border-l-primary'
      : 'border-l-transparent hover:bg-muted/25'}"
    aria-expanded={open}
    {disabled}
    onclick={handleToggle}
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
      class="border-t border-border/25 px-4 pb-4 pt-3 sm:border-border/40 sm:px-5 sm:pb-5 sm:pt-4"
    >
      {@render children?.()}
    </div>
  {/if}
</section>
