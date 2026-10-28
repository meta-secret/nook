<!-- A step's heading: where in setup it is, what it asks, and at most one
short line under it. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ui } from './ui'

  let { eyebrow, title, sub = '', children }: { eyebrow: string; title: string; sub?: string; children?: Snippet } = $props()
</script>

<header class="mb-8">
  <p class={ui.eyebrow}>{eyebrow}</p>
  <h1 class={ui.title}>{title}</h1>
  {#if sub}<p class={ui.sub}>{sub}</p>{/if}
  {@render children?.()}
</header>
