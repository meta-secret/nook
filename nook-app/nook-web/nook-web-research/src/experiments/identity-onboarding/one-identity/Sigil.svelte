<!-- An identity's sigil: a mirrored 5×5 glyph and a tint, both drawn from its
three public words, on a tanto-cut plate. The same words give the same sigil
on every device. Locked, it keeps its shape in grey; with no words it is an
empty plate that can breathe while a passkey is awaited. -->
<script lang="ts">
  import { Lock } from '@lucide/svelte'
  import { fade } from 'svelte/transition'

  let {
    words = '',
    size = 64,
    locked = false,
    breathing = false,
    reveal = false,
  }: {
    words?: string
    size?: number
    locked?: boolean
    /** The empty plate pulses, as while a passkey is awaited. */
    breathing?: boolean
    /** The glyph builds cell by cell, as when the identity is created. */
    reveal?: boolean
  } = $props()

  /** Low-chroma metal tints that sit beside the titanium accent. */
  const tints = ['#8fa3c0', '#8fb3a6', '#b39a76', '#a693b0', '#a9b0b8', '#9fb08a']

  function hash(text: string): number {
    let value = 0x811c9dc5
    for (const char of text) {
      value ^= char.charCodeAt(0)
      value = Math.imul(value, 0x01000193) >>> 0
    }
    return value
  }

  const seed = $derived(hash(words))
  const tint = $derived(String(tints[seed % tints.length]))
  /** Eight of the fifteen cells in the left three columns, ranked by their
   * own hash so every sigil has the same density, mirrored onto the right
   * two columns. */
  const cells = $derived.by(() => {
    if (!words) return []
    const ranked = Array.from({ length: 15 }, (_, index) => ({ index, score: hash(`${words}:${index}`) }))
      .sort((left, right) => left.score - right.score)
      .slice(0, 8)
      .map((cell) => cell.index)
      .sort((left, right) => left - right)
    return ranked.flatMap((index) => {
      const x = index % 3
      const y = Math.floor(index / 3)
      return x < 2 ? [{ x, y, order: index }, { x: 4 - x, y, order: index }] : [{ x, y, order: index }]
    })
  })
  const grid = Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }))
</script>

<div
  class="relative grid shrink-0 place-items-center bg-[#202428] [clip-path:polygon(0_0,82%_0,100%_18%,100%_100%,0_100%)] {breathing ? 'animate-pulse' : ''}"
  style="width: {size}px; height: {size}px"
>
  <svg viewBox="-0.2 -0.2 5.4 5.4" width={size * 0.6} height={size * 0.6} aria-hidden="true">
    {#if cells.length === 0}
      {#each grid as dot (`${dot.x}:${dot.y}`)}
        <rect x={dot.x + 0.38} y={dot.y + 0.38} width="0.24" height="0.24" fill="#3a3f45" />
      {/each}
    {:else}
      {#key words}
        {#each cells as cell (`${cell.x}:${cell.y}`)}
          <rect
            x={cell.x + 0.06}
            y={cell.y + 0.06}
            width="0.88"
            height="0.88"
            fill={locked ? '#4a5058' : tint}
            class="transition-[fill] duration-500"
            in:fade|global={{ delay: reveal ? cell.order * 45 : 0, duration: reveal ? 260 : 0 }}
          />
        {/each}
      {/key}
    {/if}
  </svg>
  {#if locked}
    <span class="absolute right-0 bottom-0 grid place-items-center bg-[#2a2e33] text-[#a4a8ae]" style="width: {size * 0.34}px; height: {size * 0.34}px">
      <Lock style="width: {size * 0.18}px; height: {size * 0.18}px" aria-label="Locked" />
    </span>
  {/if}
</div>
