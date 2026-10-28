<!-- Key management as a state machine: no vaults, only identities and the
keys that open them. The map on the left shows where you are and where you
can go; the screen on the right is that state. Simulator switches decide what
the sync provider holds and whether your passkey opens its identities. -->
<script lang="ts">
  import { RotateCcw } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import Screen from './Screen.svelte'
  import StateMap from './StateMap.svelte'
  import { KeyFlow } from './key-flow.svelte'
  import { PasskeyFit, ProviderHolds } from './machine'
  import { ui } from '../identity-first/ui'

  let { navigate }: ExperimentProps = $props()

  const flow = new KeyFlow()

  const holds: readonly { id: ProviderHolds; label: string }[] = [
    { id: ProviderHolds.Identities, label: 'Provider holds identities' },
    { id: ProviderHolds.Nothing, label: 'Provider empty' },
  ]
  const fits: readonly { id: PasskeyFit; label: string }[] = [
    { id: PasskeyFit.Opens, label: 'Passkey opens one' },
    { id: PasskeyFit.Sealed, label: 'Sealed to me' },
  ]
  const segment = 'px-3 py-1.5 transition'
  const on = 'bg-[#e9e8e4] text-[#0b0c0d]'
  const off = 'text-[#8a8f96] hover:text-[#e9e8e4]'
</script>

<svelte:head>
  <title>Key management machine · Nook research</title>
</svelte:head>

<main class={ui.page}>
  <ExperimentBack {navigate} />

  <div class="fixed top-5 right-5 z-50 flex flex-col items-end gap-2 font-mono text-[11px] tracking-wide">
    <div class="flex border border-[#2c3035] bg-[#0b0c0d]/90" role="group" aria-label="Simulated provider">
      {#each holds as entry (entry.id)}
        <button type="button" class="{segment} {flow.providerHolds === entry.id ? on : off}" onclick={() => (flow.providerHolds = entry.id)}>{entry.label}</button>
      {/each}
    </div>
    <div class="flex border border-[#2c3035] bg-[#0b0c0d]/90" role="group" aria-label="Simulated passkey">
      {#each fits as entry (entry.id)}
        <button type="button" class="{segment} {flow.passkeyFit === entry.id ? on : off}" onclick={() => (flow.passkeyFit = entry.id)}>{entry.label}</button>
      {/each}
    </div>
    <button type="button" class="{segment} inline-flex items-center gap-1.5 border border-[#2c3035] bg-[#0b0c0d]/90 {off}" onclick={() => flow.reset()}>
      <RotateCcw class="size-3" aria-hidden="true" /> Reset
    </button>
  </div>

  <div class="mx-auto grid w-full max-w-[1080px] gap-12 px-5 pt-28 pb-16 lg:grid-cols-[260px_minmax(0,1fr)]">
    <aside class="lg:sticky lg:top-28 lg:self-start">
      <StateMap {flow} />
    </aside>
    <section class="max-w-[560px]">
      <Screen {flow} />
    </section>
  </div>
</main>
