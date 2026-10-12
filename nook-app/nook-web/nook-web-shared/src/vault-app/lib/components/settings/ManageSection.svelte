<!--
One titled block on a management page. Pages are short enough that nothing
needs to collapse; the title row carries the section's status tag.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    subtitle = '',
    testId,
    badge,
    children,
  }: {
    title: string
    subtitle?: string
    testId?: string
    badge?: Snippet
    children?: Snippet
  } = $props()
</script>

<section class="grid min-w-0 grid-cols-1 gap-3" data-testid={testId}>
  <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
    <div class="min-w-0">
      <h2 class="text-base font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {#if subtitle}
        <p class="mt-0.5 max-w-[64ch] text-sm text-pretty text-muted-foreground">
          {subtitle}
        </p>
      {/if}
    </div>
    {#if badge}
      <div class="shrink-0">{@render badge()}</div>
    {/if}
  </header>
  <div class="min-w-0">
    {@render children?.()}
  </div>
</section>
