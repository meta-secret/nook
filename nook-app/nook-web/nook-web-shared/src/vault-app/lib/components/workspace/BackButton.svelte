<!--
The way back from an inner page: a full-size square button that sits on
the same row as the page's title, so going back costs no line of its own.
-->
<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";

  let {
    label,
    testId,
    onBack,
  }: {
    /** Where Back goes, for screen readers and the tooltip. */
    label: string;
    testId: string;
    onBack: () => void;
  } = $props();
</script>

<button
  type="button"
  class="inline-flex size-11 shrink-0 items-center justify-center border border-border bg-background/60 text-foreground transition-colors hover:border-foreground/60 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  aria-label={label}
  title={label}
  data-testid={testId}
  onclick={onBack}
>
  <ArrowLeft class="size-5" aria-hidden="true" />
</button>
