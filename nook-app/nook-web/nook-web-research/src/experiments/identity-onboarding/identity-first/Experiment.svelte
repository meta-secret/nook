<!-- Identity first: who you are is settled before vaults or sync providers.
Three scenarios — first run, connecting a provider while an identity is in
use, and the Identities hub — share one way to bring an existing identity:
say where it is kept, tap your passkey once. -->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ConnectProvider from './ConnectProvider.svelte'
  import FirstRun from './FirstRun.svelte'
  import Hub from './Hub.svelte'
  import { PasskeyOutcome, Scenario } from './flow'
  import { ui } from './ui'

  let { navigate }: ExperimentProps = $props()

  let scenario = $state<Scenario>(Scenario.FirstRun)
  let outcome = $state<PasskeyOutcome>(PasskeyOutcome.Matches)

  const scenarios: readonly { id: Scenario; label: string }[] = [
    { id: Scenario.FirstRun, label: 'First run' },
    { id: Scenario.ConnectProvider, label: 'Connect a provider' },
    { id: Scenario.Hub, label: 'Identities hub' },
  ]
  const outcomes: readonly { id: PasskeyOutcome; label: string }[] = [
    { id: PasskeyOutcome.Matches, label: 'Passkey matches' },
    { id: PasskeyOutcome.NoMatch, label: 'No match' },
  ]
  const segment = 'px-3 py-1.5 transition'
</script>

<svelte:head>
  <title>Identity first · Nook research</title>
</svelte:head>

<main class={ui.page}>
  <ExperimentBack {navigate} />

  <div class="fixed top-5 right-5 z-50 flex flex-col items-end gap-2 font-mono text-[11px] tracking-wide">
    <div class="flex border border-[#2c3035] bg-[#0b0c0d]/90" role="group" aria-label="Scenario">
      {#each scenarios as entry (entry.id)}
        <button
          type="button"
          class="{segment} {scenario === entry.id ? 'bg-[#e9e8e4] text-[#0b0c0d]' : 'text-[#8a8f96] hover:text-[#e9e8e4]'}"
          onclick={() => (scenario = entry.id)}
        >{entry.label}</button>
      {/each}
    </div>
    <div class="flex border border-[#2c3035] bg-[#0b0c0d]/90" role="group" aria-label="Simulated passkey">
      {#each outcomes as entry (entry.id)}
        <button
          type="button"
          class="{segment} {outcome === entry.id ? 'bg-[#e9e8e4] text-[#0b0c0d]' : 'text-[#8a8f96] hover:text-[#e9e8e4]'}"
          onclick={() => (outcome = entry.id)}
        >{entry.label}</button>
      {/each}
    </div>
  </div>

  <div class={ui.sheet}>
    {#key scenario}
      {#if scenario === Scenario.FirstRun}
        <FirstRun {outcome} />
      {:else if scenario === Scenario.ConnectProvider}
        <ConnectProvider />
      {:else}
        <Hub {outcome} />
      {/if}
    {/key}
  </div>
</main>
