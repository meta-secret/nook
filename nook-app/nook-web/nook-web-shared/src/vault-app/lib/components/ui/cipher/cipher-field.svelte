<script lang="ts">
  import { untrack } from 'svelte'
  import { cn } from '$lib/utils'
  import {
    CipherBlock,
    cipherMotionAllowed,
    type CipherDimensions,
    type CipherLine,
  } from './cipher-text'

  let {
    rows = 22,
    columns = 184,
    crawl = false,
    intervalMs = 140,
    class: className = '',
  }: {
    rows?: number
    columns?: number
    /** The lit run jumps to a new place, then crawls a stretch along its
     * row, instead of flashing somewhere new every tick. */
    crawl?: boolean
    intervalMs?: number
    class?: string
  } = $props()

  const dimensions: CipherDimensions = untrack(() => ({ rows, columns }))
  const block = new CipherBlock(dimensions)
  let lines = $state<readonly CipherLine[]>(block.segments)

  $effect(() => {
    const timer = window.setInterval(
      () => {
        if (!cipherMotionAllowed()) return
        if (crawl) block.crawl(1)
        else block.tick(10)
        lines = block.segments
      },
      untrack(() => intervalMs),
    )
    return () => window.clearInterval(timer)
  })
</script>

<pre class={cn('nk-cipher', className)} aria-hidden="true">{#each lines as line, row (row)}<span
    class="block"
    >{#each line as segment, index (index)}{#if segment.hot}<span
          class="nk-cipher-hot">{segment.text}</span
        >{:else}{segment.text}{/if}{/each}</span
  >{/each}</pre>
