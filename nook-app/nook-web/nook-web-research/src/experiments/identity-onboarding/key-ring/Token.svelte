<!-- An identity on a sync provider: its name once it is yours, its three
words while it is locked, one key mark per key, and its standing as an icon.
A change of standing replays a short scale-in. -->
<script lang="ts">
  import { ArrowLeftRight, KeyRound, Lock, LockOpen, Send, UserRound } from '@lucide/svelte'
  import { scale } from 'svelte/transition'
  import { Standing, type Identity } from './model'

  let {
    identity,
    standing,
    mine = false,
    keys = identity.keys.length,
  }: {
    identity: Identity
    standing: Standing
    /** Your own identity, synced. */
    mine?: boolean
    keys?: number
  } = $props()

  const open = $derived(mine || standing === Standing.Yours)
  const label = $derived(open && identity.name ? identity.name : identity.words)
  const frame = $derived(
    mine
      ? 'border-[#4a5058] text-[#e9e8e4] bg-[#15181b]'
      : {
          [Standing.Unknown]: 'border-[#2c3035] text-[#80858c]',
          [Standing.Locked]: 'border-[#2c3035] text-[#5d6268]',
          [Standing.Yours]: 'border-[#9cc3a4] text-[#e9e8e4] bg-[#141a16]',
          [Standing.Asked]: 'border-dashed border-[#d2b07a] text-[#d6d5d1]',
        }[standing],
  )
  const marks = $derived(Array.from({ length: Math.min(keys, 4) }, (_, index) => index))
</script>

{#key `${standing}:${mine}`}
  <div class="flex min-w-0 items-center gap-2 border px-2.5 py-1.5 {frame}" title={identity.words} in:scale={{ start: 0.92, duration: 240 }}>
    {#if mine}
      <UserRound class="size-3.5 shrink-0" aria-hidden="true" />
    {:else if standing === Standing.Yours}
      <LockOpen class="size-3.5 shrink-0 text-[#9cc3a4]" aria-hidden="true" />
    {:else if standing === Standing.Asked}
      <Send class="size-3.5 shrink-0 text-[#d2b07a]" aria-hidden="true" />
    {:else}
      <Lock class="size-3.5 shrink-0" aria-hidden="true" />
    {/if}
    <span class="min-w-0 truncate {open ? 'text-[13px] font-medium' : 'font-mono text-[12px]'}">{label}</span>
    <span class="ml-auto flex shrink-0 items-center gap-0.5" aria-label="{keys} keys">
      {#if mine}<ArrowLeftRight class="mr-1 size-3 text-[#a4a8ae]" aria-label="Synced" />{/if}
      {#each marks as mark (mark)}
        <KeyRound class="size-3 opacity-60" aria-hidden="true" />
      {/each}
    </span>
  </div>
{/key}
