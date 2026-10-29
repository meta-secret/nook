<!-- An identity's mark: a tanto-cut plate tinted from its public words. A
member sees the first letter of its name; anyone else sees a lock, because
the name is sealed to members. -->
<script lang="ts">
  import { Lock } from '@lucide/svelte'

  let {
    words,
    name = '',
    size = 44,
  }: { words: string; name?: string; size?: number } = $props()

  /** Low-chroma tints that sit beside the titanium accent. */
  const tints = [
    '#3b4656',
    '#3a4a45',
    '#4a4136',
    '#443c4a',
    '#3d4248',
    '#424a38',
  ]

  function hash(text: string): number {
    let value = 0x811c9dc5
    for (const char of text) {
      value ^= char.charCodeAt(0)
      value = Math.imul(value, 0x01000193) >>> 0
    }
    return value
  }

  const tint = $derived(
    name ? String(tints[hash(words) % tints.length]) : '#202428',
  )
</script>

<span
  class="grid shrink-0 place-items-center font-semibold text-[#e9e8e4] [clip-path:polygon(0_0,78%_0,100%_22%,100%_100%,0_100%)]"
  style="width: {size}px; height: {size}px; background: {tint}; font-size: {size *
    0.42}px"
>
  {#if name}
    {name.slice(0, 1).toUpperCase()}
  {:else}
    <Lock
      class="text-[#80858c]"
      style="width: {size * 0.36}px; height: {size * 0.36}px"
      aria-label="Sealed"
    />
  {/if}
</span>
