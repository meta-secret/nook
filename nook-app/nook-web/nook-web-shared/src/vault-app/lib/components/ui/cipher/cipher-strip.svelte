<script lang="ts">
  import { untrack } from 'svelte'
  import { cn } from '$lib/utils'
  import { CipherStripText, cipherMotionAllowed } from './cipher-text'

  let {
    length = 48,
    class: className = '',
  }: {
    length?: number
    class?: string
  } = $props()

  const strip = new CipherStripText(untrack(() => length))
  let text = $state(strip.text)

  $effect(() => {
    const timer = window.setInterval(() => {
      if (!cipherMotionAllowed()) return
      strip.tick(3)
      text = strip.text
    }, 160)
    return () => window.clearInterval(timer)
  })
</script>

<span class={cn('nk-cipher-strip', className)} aria-hidden="true">{text}</span>
