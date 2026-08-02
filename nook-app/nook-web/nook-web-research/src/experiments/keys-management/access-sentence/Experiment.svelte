<!--
DIRECTION: No diagram at all. The access chain is one sentence; each link is an
inline token you can open in place to read its evidence.
-->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    ChainStage,
    FactKind,
    factText,
    isPrepared,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageEvidence,
    stageIdentifier,
    stageMeaning,
    stageTitle,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let openStage = $state(ChainStage.Passkey)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const evidence = $derived(stageEvidence(scenario, openStage))
  const identifier = $derived(stageIdentifier(scenario, openStage))

  function tokenClass(stage: ChainStage): string {
    return openStage === stage
      ? 'border-black bg-black text-[#f5f4f0]'
      : 'border-black/25 hover:border-black/70'
  }
</script>

<main class="min-h-[100svh] bg-[#f5f4f0] text-black">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      openStage = ChainStage.Passkey
    }}
  />

  <section class="mx-auto max-w-4xl px-6 py-24 sm:py-32">
    <p class="font-mono text-xs tracking-[0.22em] text-black/45 uppercase">
      Devices &amp; access
    </p>

    <h1
      class="mt-8 text-3xl leading-[1.45] font-light tracking-[-0.02em] sm:text-[2.6rem] sm:leading-[1.4]"
    >
      Your
      <button
        class={`mx-1 rounded-md border px-2 py-0.5 align-baseline transition ${tokenClass(ChainStage.Passkey)}`}
        onclick={() => (openStage = ChainStage.Passkey)}
      >
        {stageTitle(scenario, ChainStage.Passkey)}
      </button>
      passkey unlocks
      <button
        class={`mx-1 rounded-md border px-2 py-0.5 align-baseline transition ${tokenClass(ChainStage.DeviceKey)}`}
        onclick={() => (openStage = ChainStage.DeviceKey)}
      >
        this browser
      </button>{prepared ? ', which opens' : '. Nothing here opens'}
      <button
        class={`mx-1 rounded-md border px-2 py-0.5 align-baseline transition ${tokenClass(ChainStage.Vaults)}`}
        onclick={() => (openStage = ChainStage.Vaults)}
      >
        {stageTitle(scenario, ChainStage.Vaults)}
      </button>.
    </h1>
    <p class="mt-6 max-w-xl text-sm leading-6 text-black/50">
      Open any highlighted link to read exactly what Nook knows about it.
    </p>

    <div
      class="mt-16 grid gap-10 border-t border-black/15 pt-10 sm:grid-cols-[10rem_1fr]"
    >
      <div>
        <p
          class="font-mono text-[11px] tracking-[0.18em] text-black/45 uppercase"
        >
          {stageCaption(openStage)}
        </p>
        {#if identifier.kind === FactKind.Known}
          <p class="mt-3 font-mono text-xs break-all text-black/70">
            {identifier.value}
          </p>
        {:else}
          <p class="mt-3 text-xs text-black/45 italic">{identifier.reason}</p>
        {/if}
      </div>

      <div>
        <p class="max-w-xl text-base leading-7 text-black/70">
          {stageMeaning(openStage)}
        </p>
        <dl class="mt-8 max-w-xl">
          {#each evidence as row (row.label)}
            <div
              class="flex flex-wrap items-baseline justify-between gap-4 border-b border-black/10 py-3"
            >
              <dt class="text-sm text-black/50">{row.label}</dt>
              <dd
                class={`text-sm ${row.fact.kind === FactKind.Known ? 'font-mono break-all' : 'text-black/40 italic'}`}
              >
                {factText(row.fact)}
              </dd>
            </div>
          {/each}
        </dl>
      </div>
    </div>

    {#if !prepared}
      <div class="mt-12 rounded-xl border border-dashed border-black/30 p-6">
        <p class="text-sm leading-6 text-black/60">
          Prepare this browser and the sentence above becomes true: a passkey
          you choose, a device key only this browser holds, and the vaults it
          opens.
        </p>
        <button
          class="mt-5 rounded-full bg-black px-6 py-3 text-sm font-medium text-[#f5f4f0]"
        >
          Prepare this browser
        </button>
      </div>
    {/if}
  </section>
</main>
