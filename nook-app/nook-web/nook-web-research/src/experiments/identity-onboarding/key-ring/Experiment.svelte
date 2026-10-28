<!-- Key management as one key ring. Onboarding creates an identity on this
browser or imports one from a sync provider; after that the ring is the app:
keys that open your identity on one side, places it is synced to on the other,
and every action a slot or a panel on that one screen. Simulator switches
decide what the provider holds and send join requests from other devices. -->
<script lang="ts">
  import { ArrowLeft, ArrowRight, RotateCcw, Send } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import RingMap from './RingMap.svelte'
  import Screen from './Screen.svelte'
  import { RingFlow } from './ring-flow.svelte'
  import { ProviderHolds } from './ring'
  import { ui } from '../identity-first/ui'

  let { navigate }: ExperimentProps = $props()

  const flow = new RingFlow()

  const holds: readonly { id: ProviderHolds; label: string }[] = [
    { id: ProviderHolds.Yours, label: 'Provider has yours' },
    { id: ProviderHolds.Locked, label: 'Only locked ones' },
    { id: ProviderHolds.Nothing, label: 'Empty' },
  ]
  const segment = 'px-3 py-1.5 transition'
  const on = 'bg-[#e9e8e4] text-[#0b0c0d]'
  const off = 'text-[#8a8f96] hover:text-[#e9e8e4]'
</script>

<svelte:head>
  <title>Key ring · Nook research</title>
</svelte:head>

<main class={ui.page}>
  <ExperimentBack {navigate} />

  <div class="fixed top-5 right-5 z-50 flex flex-col items-end gap-2 font-mono text-[11px] tracking-wide">
    <div class="flex border border-[#2c3035] bg-[#0b0c0d]/90" role="group" aria-label="Simulated provider">
      {#each holds as entry (entry.id)}
        <button type="button" class="{segment} {flow.holds === entry.id ? on : off}" onclick={() => (flow.holds = entry.id)}>{entry.label}</button>
      {/each}
    </div>
    <div class="flex gap-2">
      {#if flow.ready}
        <button type="button" class="{segment} inline-flex items-center gap-1.5 border border-[#2c3035] bg-[#0b0c0d]/90 {off}" onclick={() => flow.deviceAsks()}>
          <Send class="size-3" aria-hidden="true" /> Device asks to join
        </button>
      {/if}
      <button type="button" class="{segment} inline-flex items-center gap-1.5 border border-[#2c3035] bg-[#0b0c0d]/90 {off}" onclick={() => flow.reset()}>
        <RotateCcw class="size-3" aria-hidden="true" /> Reset
      </button>
    </div>
  </div>

  <div class="mx-auto grid w-full max-w-[1120px] gap-12 px-5 pt-28 pb-16 lg:grid-cols-[240px_minmax(0,1fr)]">
    <aside class="lg:sticky lg:top-28 lg:self-start">
      <RingMap {flow} />
    </aside>
    <section class="max-w-[680px]">
      {#if flow.history.length > 1}
        <nav class="mb-8 flex items-center gap-4" aria-label="History">
          <button type="button" class="{ui.link} inline-flex items-center gap-1.5 disabled:opacity-30" disabled={!flow.canBack()} onclick={() => flow.back()}>
            <ArrowLeft class="size-3.5" aria-hidden="true" /> Back
          </button>
          <button type="button" class="{ui.link} inline-flex items-center gap-1.5 disabled:opacity-30" disabled={!flow.canForward()} onclick={() => flow.forward()}>
            Forward <ArrowRight class="size-3.5" aria-hidden="true" />
          </button>
          <span class="ml-auto font-mono text-[11px] text-[#5d6268]">step {flow.cursor + 1} of {flow.history.length}</span>
        </nav>
      {/if}
      <Screen {flow} />
    </section>
  </div>
</main>
