<!--
A setup step drawn small: a row of boxes joined by arrows, the one the step
is about filled in. The steps say what they are for with it instead of a
paragraph.
-->
<script lang="ts">
  import { ChevronRight } from '@lucide/svelte'
  import type {
    FirstRunDiagramNode,
    FirstRunDiagramView,
  } from './first-run-diagram'

  let { diagram }: { diagram: FirstRunDiagramView } = $props()
</script>

{#snippet node(box: FirstRunDiagramNode)}
  <div class="flex w-11 flex-col items-center gap-2">
    <span
      class="grid size-11 shrink-0 place-items-center border {box.current
        ? 'border-foreground bg-foreground text-background'
        : 'border-border text-muted-foreground'}"
      data-testid={box.testId}
      {...box.current ? { 'aria-current': 'step' } : {}}
    >
      <box.icon class="size-5" aria-hidden="true" />
    </span>
    <span
      class="w-24 shrink-0 text-center text-[11px] leading-tight {box.current
        ? 'font-semibold text-foreground'
        : 'text-muted-foreground'}"
    >
      {box.label}
    </span>
  </div>
{/snippet}

<figure
  class="m-0 mx-auto flex w-full max-w-md items-start gap-x-2 px-8"
  aria-label={diagram.label}
  data-testid={diagram.testId}
>
  {#each diagram.nodes as box, index (box.testId)}
    {#if index > 0}
      <span
        class="mt-[1.375rem] flex min-w-6 flex-1 -translate-y-1/2 items-center text-muted-foreground"
        aria-hidden="true"
      >
        <span class="h-px flex-1 border-t border-dashed border-border"></span>
        <ChevronRight class="-ml-1 size-3.5" />
      </span>
    {/if}
    {@render node(box)}
  {/each}
</figure>
