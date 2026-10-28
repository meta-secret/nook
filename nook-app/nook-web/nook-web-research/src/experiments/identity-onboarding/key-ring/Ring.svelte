<!-- The one picture of the app: your identity in the middle, the keys that
open it on the left, where it is kept on the right. Identities found on a sync
provider sit inside that provider. During onboarding the ring shows what is
about to exist as dashed outlines; afterwards what you can add is a dashed
slot, and a device asking to join is a pending key with its answer beside it. -->
<script lang="ts">
  import {
    Check,
    Cloud,
    KeyRound,
    Lock,
    LockOpen,
    Monitor,
    Plus,
    Send,
    Smartphone,
    UserRound,
    X,
  } from '@lucide/svelte'
  import { scale } from 'svelte/transition'
  import type { KeyRingFlow } from './flow.svelte'
  import { KeyKind, Standing, Step, browserKey, type Identity, type Key } from './model'
  import Token from './Token.svelte'

  let { flow }: { flow: KeyRingFlow } = $props()

  const head = 'mb-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#80858c] uppercase'
  const shape = 'relative flex min-h-10 items-center gap-2 border px-3 text-[13px]'
  const solid = 'border-[#2c3035] bg-[#131517] text-[#d6d5d1]'
  const ghost = 'border-dashed border-[#3a3f45] text-[#80858c]'
  const toCenter = "after:absolute after:top-5 after:-right-3.5 after:h-px after:w-3.5 after:bg-[#3a3f45] after:content-['']"
  const fromCenter = "before:absolute before:top-5 before:-left-3.5 before:h-px before:w-3.5 before:bg-[#3a3f45] before:content-['']"
  const warn = 'font-mono text-[10px] tracking-[0.12em] text-[#d2b07a] uppercase'

  /** Onboarding: nothing exists yet, so the ring draws what will. */
  const onboarding = $derived(!flow.ready)
  const shown = $derived<readonly Identity[]>(onboarding ? flow.onProvider : flow.others())
  const standings = $derived(shown.map((identity) => flow.standing(identity)))
  const opensPanel = $derived(flow.ready && (!flow.saved || shown.length > 0))
  const mine = $derived<Identity>({ id: 'self', name: flow.name, words: flow.words, keys: flow.keys })
</script>

{#snippet keyRow(key: Key, pending: boolean)}
  <li class="{shape} {toCenter} {pending ? 'border-dashed border-[#d2b07a] bg-[#131517] text-[#d6d5d1]' : solid}" in:scale={{ start: 0.9, duration: 260 }}>
    {#if pending}
      <Send class="size-3.5 shrink-0 text-[#d2b07a]" aria-hidden="true" />
    {:else if key.kind === KeyKind.Device}
      <Smartphone class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
    {:else}
      <KeyRound class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
    {/if}
    <span class="min-w-0 truncate">{key.device}</span>
    {#if pending}
      <span class="ml-auto flex shrink-0 gap-1">
        <button type="button" class="grid size-6 place-items-center border border-[#2c3035] text-[#9cc3a4] hover:border-[#9cc3a4]" aria-label="Approve {key.device}" onclick={() => flow.answer(key, true)}>
          <Check class="size-3.5" aria-hidden="true" />
        </button>
        <button type="button" class="grid size-6 place-items-center border border-[#2c3035] text-[#80858c] hover:border-[#80858c]" aria-label="Deny {key.device}" onclick={() => flow.answer(key, false)}>
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </span>
    {:else if key.here}
      <span class="ml-auto size-1.5 shrink-0 bg-[#8fa3c0]" title="This browser"></span>
    {/if}
  </li>
{/snippet}

{#snippet providerContents()}
  <span class="flex items-center gap-2">
    <Cloud class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
    <span class="min-w-0 truncate">{flow.provider}</span>
  </span>
  {#if (flow.ready && flow.saved) || shown.length > 0}
    <span class="flex flex-col gap-1.5 pb-1">
      {#if flow.ready && flow.saved}
        <Token identity={mine} standing={Standing.Yours} mine />
      {/if}
      {#each shown as identity (identity.id)}
        <Token {identity} standing={flow.standing(identity)} />
      {/each}
    </span>
  {/if}
{/snippet}

<figure class="space-y-3">
  <figcaption class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[11px] text-[#5d6268]">
    <span class="tracking-[0.14em] text-[#80858c] uppercase">Your identity</span>
    <span class="flex flex-wrap items-center gap-x-3">
      {#if standings.includes(Standing.Unknown) || standings.includes(Standing.Locked)}
        <span class="inline-flex items-center gap-1"><Lock class="size-3" aria-hidden="true" /> locked</span>
      {/if}
      {#if standings.includes(Standing.Yours)}
        <span class="inline-flex items-center gap-1 text-[#9cc3a4]"><LockOpen class="size-3" aria-hidden="true" /> yours</span>
      {/if}
      {#if standings.includes(Standing.Asked) || flow.requests.length > 0}
        <span class="inline-flex items-center gap-1 text-[#d2b07a]"><Send class="size-3" aria-hidden="true" /> request</span>
      {/if}
    </span>
  </figcaption>

  <div class="grid grid-cols-[minmax(0,1fr)_28px_auto_28px_minmax(0,1fr)] items-center">
    <div>
      <p class={head}>
        <KeyRound class="size-3.5" aria-hidden="true" /> Keys
        {#if flow.ready && flow.keys.length === 1}<span class={warn}>· only one</span>{/if}
      </p>
      <ul class="space-y-2 border-r border-[#3a3f45] pr-3.5">
        {#if onboarding}
          <li class="{shape} {toCenter} {ghost}">
            <KeyRound class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{browserKey.device}</span>
          </li>
        {:else}
          {#each flow.keys as key (key.id)}
            {@render keyRow(key, false)}
          {/each}
          {#each flow.requests as key (key.id)}
            {@render keyRow(key, true)}
          {/each}
          <li>
            <button
              type="button"
              class="{shape} {toCenter} w-full border-dashed text-left transition hover:border-[#8fa3c0] hover:text-[#e9e8e4] {flow.step === Step.AddKey ? 'border-[#8fa3c0] text-[#e9e8e4]' : 'border-[#3a3f45] text-[#80858c]'}"
              onclick={() => flow.go(Step.AddKey)}
            >
              <Plus class="size-3.5" aria-hidden="true" /> Key
            </button>
          </li>
        {/if}
      </ul>
    </div>

    <span class="h-px bg-[#3a3f45]" aria-hidden="true"></span>

    <!-- A new key count replays the scale-in, so the identity shows it
    gained keys. -->
    {#key `${flow.ready}:${flow.keys.length}`}
      <div
        class="flex w-[148px] flex-col items-center gap-1.5 border px-3 py-4 text-center {flow.ready ? 'border-[#c9ccd0] bg-[#181b1e]' : 'border-dashed border-[#4a5058]'}"
        in:scale={{ start: 0.94, duration: 260 }}
      >
        <UserRound class="size-5 {flow.ready ? 'text-[#e9e8e4]' : 'text-[#5d6268]'}" aria-hidden="true" />
        {#if flow.ready || flow.step === Step.Create}
          <span class="w-full truncate text-[17px] font-semibold {flow.ready ? 'text-[#e9e8e4]' : 'text-[#a4a8ae]'}">{flow.name || '·'}</span>
        {/if}
        {#if flow.ready}
          <span class="w-full truncate font-mono text-[11px] text-[#80858c]">{flow.words}</span>
          <span class="mt-1 font-mono text-[11px] text-[#a4a8ae]">{flow.keys.length} {flow.keys.length === 1 ? 'key' : 'keys'}</span>
        {/if}
      </div>
    {/key}

    <span class="h-px bg-[#3a3f45]" aria-hidden="true"></span>

    <div>
      <p class={head}><Cloud class="size-3.5" aria-hidden="true" /> Kept in</p>
      <ul class="space-y-2 border-l border-[#3a3f45] pl-3.5">
        <li class="{shape} {fromCenter} {onboarding ? ghost : solid}">
          <Monitor class="size-3.5 shrink-0 text-[#80858c]" aria-hidden="true" />
          <span class="min-w-0 truncate">This browser</span>
          {#if flow.ready && !flow.provider}<span class="ml-auto {warn}">only here</span>{/if}
        </li>
        {#if flow.provider}
          <li in:scale={{ start: 0.9, duration: 260 }}>
            {#if opensPanel}
              <button
                type="button"
                class="{shape} {fromCenter} w-full flex-col items-stretch gap-1.5 py-2.5 text-left transition hover:border-[#8fa3c0] {flow.saved ? solid : ghost} {flow.step === Step.Provider ? 'border-[#8fa3c0]' : ''}"
                aria-label="{flow.provider}: {shown.length} more"
                onclick={() => flow.go(Step.Provider)}
              >
                {@render providerContents()}
              </button>
            {:else}
              <div class="{shape} {fromCenter} flex-col items-stretch gap-1.5 py-2.5 {flow.saved ? solid : flow.ready ? ghost : solid}">
                {@render providerContents()}
              </div>
            {/if}
          </li>
        {:else if flow.ready}
          <li>
            <button
              type="button"
              class="{shape} {fromCenter} w-full border-dashed text-left transition hover:border-[#8fa3c0] hover:text-[#e9e8e4] {flow.step === Step.AddProvider ? 'border-[#8fa3c0] text-[#e9e8e4]' : 'border-[#d2b07a]/60 text-[#d2b07a]'}"
              onclick={() => flow.go(Step.AddProvider)}
            >
              <Plus class="size-3.5" aria-hidden="true" /> Sync provider
            </button>
          </li>
        {/if}
      </ul>
    </div>
  </div>
</figure>
