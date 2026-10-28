<!-- An identity as a token: its name (or sealed words), its keys as small
key marks, and its state shown by shape and icon rather than text. -->
<script lang="ts">
  import { KeyRound, Lock, LockOpen, Send, UserRound } from '@lucide/svelte'
  import { scale } from 'svelte/transition'
  import { TokenStatus, type Token } from './machine'

  let { token }: { token: Token } = $props()

  const frame = $derived(
    {
      [TokenStatus.Here]: 'border-[#c9ccd0] text-[#e9e8e4] bg-[#181b1e]',
      [TokenStatus.Ghost]: 'border-dashed border-[#5d6268] text-[#a4a8ae]',
      [TokenStatus.Synced]: 'border-[#4a5058] text-[#d6d5d1] bg-[#15181b]',
      [TokenStatus.Sealed]: 'border-[#2c3035] text-[#6f747b]',
      [TokenStatus.Opened]: 'border-[#9cc3a4] text-[#e9e8e4] bg-[#141a16]',
      [TokenStatus.Pending]: 'border-dashed border-[#d2b07a] text-[#d6d5d1]',
      [TokenStatus.Removed]: 'border-[#2c3035] text-[#5d6268] line-through opacity-50',
    }[token.status],
  )
  const marks = $derived(Array.from({ length: Math.min(token.keys, 4) }, (_, index) => index))
</script>

{#key token.status}
<div class="flex min-w-0 items-center gap-2.5 border px-3 py-2 transition {frame}" title={token.label} in:scale={{ start: 0.94, duration: 240 }}>
  {#if token.status === TokenStatus.Sealed}
    <Lock class="size-3.5 shrink-0" aria-hidden="true" />
  {:else if token.status === TokenStatus.Opened}
    <LockOpen class="size-3.5 shrink-0 text-[#9cc3a4]" aria-hidden="true" />
  {:else if token.status === TokenStatus.Pending}
    <Send class="size-3.5 shrink-0 text-[#d2b07a]" aria-hidden="true" />
  {:else}
    <UserRound class="size-3.5 shrink-0" aria-hidden="true" />
  {/if}
  <span class="min-w-0 truncate {token.status === TokenStatus.Sealed || token.status === TokenStatus.Pending ? 'font-mono text-[12px]' : 'text-[14px] font-medium'}">
    {token.label}
  </span>
  <span class="ml-auto flex shrink-0 gap-0.5" aria-label="{token.keys} keys">
    {#each marks as mark (mark)}
      <KeyRound class="size-3 opacity-70" aria-hidden="true" />
    {/each}
  </span>
</div>
{/key}
