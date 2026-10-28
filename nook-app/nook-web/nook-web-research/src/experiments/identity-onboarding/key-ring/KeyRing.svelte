<!-- The whole app on one diagram: your identity in the middle, the keys that
open it on the left, the places it is synced to on the right. What you can add
is a dashed slot in the diagram itself, a device asking to join is a pending
key with its answer beside it, and a merge shows as keys joining the ring. -->
<script lang="ts">
  import {
    ArrowLeftRight,
    Check,
    Cloud,
    KeyRound,
    Monitor,
    Plus,
    Send,
    Smartphone,
    UserRound,
    X,
  } from '@lucide/svelte'
  import { scale } from 'svelte/transition'
  import type { RingFlow } from './ring-flow.svelte'
  import { RingState } from './ring'

  let { flow }: { flow: RingFlow } = $props()

  const head =
    'mb-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#80858c] uppercase'
  const shape =
    'relative flex min-h-10 items-center gap-2 border bg-[#131517] px-3 text-[13px] text-[#d6d5d1]'
  const row = `${shape} border-[#2c3035]`
  const toCenter = "after:absolute after:top-1/2 after:-right-3.5 after:h-px after:w-3.5 after:bg-[#3a3f45] after:content-['']"
  const fromCenter = "before:absolute before:top-1/2 before:-left-3.5 before:h-px before:w-3.5 before:bg-[#3a3f45] before:content-['']"
  const slot =
    'relative flex min-h-10 w-full items-center gap-2 border border-dashed px-3 text-left text-[13px] transition hover:border-[#8fa3c0] hover:text-[#e9e8e4]'
  const warn = 'font-mono text-[10px] tracking-[0.12em] text-[#d2b07a] uppercase'

  /** "MacBook · passkey 9f8e7d6c" reads as "MacBook". */
  function short(label: string): string {
    const [first] = label.split(' · ')
    return first || label
  }

  const others = $derived(flow.others())
</script>

<figure class="space-y-3">
  <figcaption class="font-mono text-[11px] tracking-[0.14em] text-[#80858c] uppercase">Your identity</figcaption>
  <div class="grid grid-cols-[minmax(0,1fr)_28px_auto_28px_minmax(0,1fr)] items-center">
    <div>
      <p class={head}>
        <KeyRound class="size-3.5" aria-hidden="true" /> Keys
        {#if flow.keys.length === 1}<span class={warn}>· only one</span>{/if}
      </p>
      <ul class="space-y-2 border-r border-[#3a3f45] pr-3.5">
        {#each flow.keys as key (key.id)}
          <li class="{row} {toCenter}" in:scale={{ start: 0.9, duration: 260 }}>
            {#if key.kind === 'device'}
              <Smartphone class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
            {:else}
              <KeyRound class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
            {/if}
            <span class="min-w-0 truncate">{short(key.label)}</span>
            {#if key.here}<span class="ml-auto size-1.5 shrink-0 bg-[#8fa3c0]" title="This browser"></span>{/if}
          </li>
        {/each}
        {#each flow.requests as key (key.id)}
          <li class="{shape} {toCenter} border-dashed border-[#d2b07a]" in:scale={{ start: 0.9, duration: 260 }}>
            <Send class="size-3.5 shrink-0 text-[#d2b07a]" aria-hidden="true" />
            <span class="min-w-0 truncate">{short(key.label)}</span>
            <span class="ml-auto flex shrink-0 gap-1">
              <button type="button" class="grid size-6 place-items-center border border-[#2c3035] text-[#9cc3a4] hover:border-[#9cc3a4]" aria-label="Approve {short(key.label)}" onclick={() => flow.answer(key, true)}>
                <Check class="size-3.5" aria-hidden="true" />
              </button>
              <button type="button" class="grid size-6 place-items-center border border-[#2c3035] text-[#80858c] hover:border-[#80858c]" aria-label="Deny {short(key.label)}" onclick={() => flow.answer(key, false)}>
                <X class="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </li>
        {/each}
        <li>
          <button
            type="button"
            class="{slot} {toCenter} {flow.current === RingState.AddKey ? 'border-[#8fa3c0] text-[#e9e8e4]' : 'border-[#3a3f45] text-[#80858c]'}"
            onclick={() => flow.go(RingState.AddKey)}
          >
            <Plus class="size-3.5" aria-hidden="true" /> Key
          </button>
        </li>
      </ul>
    </div>

    <span class="h-px bg-[#3a3f45]" aria-hidden="true"></span>

    <!-- A changed key count replays the scale-in, so the identity itself
    shows that it gained a key. -->
    {#key flow.keys.length}
      <div class="flex w-[150px] flex-col items-center gap-1.5 border border-[#c9ccd0] bg-[#181b1e] px-3 py-4 text-center" in:scale={{ start: 0.94, duration: 260 }}>
        <UserRound class="size-5 text-[#e9e8e4]" aria-hidden="true" />
        <span class="w-full truncate text-[17px] font-semibold text-[#e9e8e4]">{flow.name}</span>
        <span class="w-full truncate font-mono text-[11px] text-[#80858c]">{flow.words}</span>
        <span class="mt-1 font-mono text-[11px] text-[#a4a8ae]">{flow.keys.length} {flow.keys.length === 1 ? 'key' : 'keys'}</span>
      </div>
    {/key}

    <span class="h-px bg-[#3a3f45]" aria-hidden="true"></span>

    <div>
      <p class={head}><Cloud class="size-3.5" aria-hidden="true" /> Synced to</p>
      <ul class="space-y-2 border-l border-[#3a3f45] pl-3.5">
        <li class="{row} {fromCenter}">
          <Monitor class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
          <span class="min-w-0 truncate">This browser</span>
          {#if !flow.provider}<span class="ml-auto {warn}">only here</span>{/if}
        </li>
        {#if flow.provider}
          <li class="{shape} {fromCenter} {flow.saved ? 'border-[#2c3035]' : 'border-dashed border-[#3a3f45] text-[#80858c]'}" in:scale={{ start: 0.9, duration: 260 }}>
            <Cloud class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
            <span class="min-w-0 truncate">{flow.provider}</span>
            {#if flow.saved}<ArrowLeftRight class="size-3.5 shrink-0 text-[#a4a8ae]" aria-label="Synced" />{/if}
            {#if others.length > 0}
              <button
                type="button"
                class="ml-auto shrink-0 border border-[#3a3f45] px-1.5 font-mono text-[11px] text-[#a4a8ae] hover:border-[#8fa3c0] hover:text-[#e9e8e4]"
                aria-label="{others.length} more identities on {flow.provider}"
                onclick={() => flow.go(RingState.Merge)}
              >
                +{others.length}
              </button>
            {/if}
          </li>
        {:else}
          <li>
            <button
              type="button"
              class="{slot} {fromCenter} {flow.current === RingState.AddProvider ? 'border-[#8fa3c0] text-[#e9e8e4]' : 'border-[#d2b07a]/60 text-[#d2b07a]'}"
              onclick={() => flow.go(RingState.AddProvider)}
            >
              <Plus class="size-3.5" aria-hidden="true" /> Sync provider
            </button>
          </li>
        {/if}
      </ul>
    </div>
  </div>
</figure>
