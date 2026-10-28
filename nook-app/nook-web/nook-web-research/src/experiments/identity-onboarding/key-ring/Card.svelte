<!-- A choice made by clicking the card itself: a few words, an optional tag,
and optionally the identity it acts on. A card that needs a passkey shows a
key and waits for the simulated tap. -->
<script lang="ts">
  import { ArrowRight, KeyRound, LoaderCircle } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { Tone } from './tone'

  let {
    title,
    tag = '',
    tone = Tone.Muted,
    passkey = false,
    disabled = false,
    onPick,
    children,
  }: {
    title: string
    tag?: string
    tone?: Tone
    /** Picking it asks for a passkey tap first. */
    passkey?: boolean
    disabled?: boolean
    onPick: () => void
    children?: Snippet
  } = $props()

  let waiting = $state(false)

  async function pick(): Promise<void> {
    if (waiting || disabled) return
    if (passkey) {
      waiting = true
      await new Promise((resolve) => setTimeout(resolve, 700))
      waiting = false
    }
    onPick()
  }

  const tagColor = $derived(
    { [Tone.Muted]: 'text-[#80858c]', [Tone.Ok]: 'text-[#9cc3a4]', [Tone.Warn]: 'text-[#d2b07a]' }[tone],
  )
</script>

<button
  type="button"
  class="group flex w-full flex-col gap-3 border border-[#24272b] bg-[#131517] px-5 py-4 text-left transition [clip-path:polygon(0_0,calc(100%-14px)_0,100%_14px,100%_100%,0_100%)] hover:border-[#4a5058] hover:bg-[#171a1d] focus-visible:border-[#8fa3c0] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
  disabled={disabled || waiting}
  onclick={pick}
>
  <span class="flex w-full items-center justify-between gap-3">
    <span class="text-[16px] font-semibold text-[#e9e8e4]">{title}</span>
    <span class="flex shrink-0 items-center gap-2">
      {#if tag}<span class="font-mono text-[11px] tracking-[0.12em] uppercase {tagColor}">{tag}</span>{/if}
      {#if waiting}
        <LoaderCircle class="size-4 animate-spin text-[#8fa3c0]" aria-label="Waiting for your passkey" />
      {:else if passkey}
        <KeyRound class="size-4 text-[#5d6268] transition group-hover:text-[#e9e8e4]" aria-hidden="true" />
      {:else}
        <ArrowRight class="size-4 text-[#5d6268] transition group-hover:translate-x-0.5 group-hover:text-[#e9e8e4]" aria-hidden="true" />
      {/if}
    </span>
  </span>
  {@render children?.()}
</button>
