<!--
Progress through a short guided flow: each step is a labelled bar, checked
once done. A `current` past the last step shows every step done.
-->
<script lang="ts">
  import { Check } from "@lucide/svelte";

  let {
    steps,
    current,
  }: {
    /** Step labels, in order. */
    steps: readonly string[];
    /** Index of the step on screen. */
    current: number;
  } = $props();
</script>

<ol
  class="grid gap-2 font-mono text-[11px] tracking-[0.08em] uppercase"
  style:grid-template-columns="repeat({steps.length}, minmax(0, 1fr))"
  data-testid="first-run-progress"
>
  {#each steps as label, index (label)}
    <li
      class={[
        "flex items-center gap-1.5 border-t-2 pt-2",
        index < current
          ? "border-success text-success"
          : index === current
            ? "border-foreground text-foreground"
            : "border-border text-muted-foreground",
      ]}
      {...index === current ? { "aria-current": "step" } : {}}
    >
      {#if index < current}
        <Check class="size-3.5 shrink-0" aria-hidden="true" />
      {/if}
      <span class="truncate">{label}</span>
    </li>
  {/each}
</ol>
