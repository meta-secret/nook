<!-- A choice the user makes by clicking the card itself: a title, what it
does, and optionally the identity and keys it is about. A card that needs a
passkey tap shows its own waiting state. -->
<script lang="ts">
  import { ArrowRight, KeyRound, LoaderCircle } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  let {
    title,
    body = '',
    tag = '',
    tagTone = 'muted',
    passkey = false,
    disabled = false,
    onPick,
    children,
  }: {
    title: string
    body?: string
    tag?: string
    tagTone?: 'muted' | 'ok' | 'warn'
    /** Picking it asks for a passkey tap first. */
    passkey?: boolean
    disabled?: boolean
    onPick: () => void | Promise<void>
    children?: Snippet
  } = $props()

  let waiting = $state(false)

  async function pick(): Promise<void> {
    if (waiting || disabled) return
    if (passkey) {
      waiting = true
      await new Promise((resolve) => setTimeout(resolve, 800))
      waiting = false
    }
    await onPick()
  }

  const tagClass = $derived(
    tagTone === 'ok'
      ? 'text-[#9cc3a4]'
      : tagTone === 'warn'
        ? 'text-[#d2b07a]'
        : 'text-[#80858c]',
  )
</script>

<button
  type="button"
  class="group relative flex w-full flex-col gap-3 border border-[#1d2023] bg-[#131517] px-5 py-4 text-left transition [clip-path:polygon(0_0,calc(100%-14px)_0,100%_14px,100%_100%,0_100%)] hover:border-[#3a3f45] hover:bg-[#171a1d] focus-visible:border-[#8fa3c0] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
  disabled={disabled || waiting}
  onclick={pick}
>
  <span class="flex w-full items-start justify-between gap-3">
    <span class="min-w-0">
      <span class="block text-[16px] font-semibold text-[#e9e8e4]">{title}</span>
      {#if body}<span class="mt-1 block text-[13px] leading-relaxed text-pretty text-[#8a8f96]">{body}</span>{/if}
    </span>
    <span class="flex shrink-0 items-center gap-2">
      {#if tag}<span class="font-mono text-[11px] tracking-[0.12em] uppercase {tagClass}">{tag}</span>{/if}
      {#if waiting}
        <LoaderCircle class="size-4 animate-spin text-[#8fa3c0]" aria-hidden="true" />
      {:else if passkey}
        <KeyRound class="size-4 text-[#5d6268] transition group-hover:text-[#e9e8e4]" aria-hidden="true" />
      {:else}
        <ArrowRight class="size-4 text-[#5d6268] transition group-hover:translate-x-0.5 group-hover:text-[#e9e8e4]" aria-hidden="true" />
      {/if}
    </span>
  </span>
  {#if waiting}
    <span class="font-mono text-[12px] text-[#8fa3c0]">Waiting for your passkey…</span>
  {/if}
  {@render children?.()}
</button>
