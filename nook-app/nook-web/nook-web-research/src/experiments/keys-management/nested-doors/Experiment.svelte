<!--
DIRECTION: A spatial metaphor instead of a diagram. Three doorways nested one
inside the next recede down a corridor: the outermost is the passkey you
present, the middle is the device key it unlocks, the innermost is what that key
opens. Walking into a door brings it forward and inscribes its evidence on it.
-->
<script lang="ts">
  import { DoorClosed, DoorOpen } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    CHAIN_STAGES,
    ChainStage,
    FactKind,
    factText,
    isPrepared,
    relationInto,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageEvidence,
    stageIdentifier,
    stageMeaning,
    stageQuestion,
    stageTitle,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let entered = $state(ChainStage.Passkey)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  const depths: Record<ChainStage, string> = {
    [ChainStage.Passkey]: 'Outermost door',
    [ChainStage.DeviceKey]: 'Second door',
    [ChainStage.Vaults]: 'Innermost door',
  }

  function frameClass(stage: ChainStage): string {
    const base =
      'rounded-t-[2.75rem] border p-5 transition duration-500 [transform-style:preserve-3d] motion-reduce:transition-none sm:p-7'
    if (!prepared) {
      return stage === entered
        ? `${base} border-dashed border-[#4a4a54] bg-[#0e0e12] [transform:translateZ(18px)]`
        : `${base} border-dashed border-[#2c2c34] bg-[#0b0b0e] [transform:translateZ(-30px)]`
    }
    return stage === entered
      ? `${base} border-[#e8b473]/55 bg-[#14100a] shadow-[0_0_70px_rgba(232,180,115,0.10)] [transform:translateZ(26px)]`
      : `${base} border-[#26262c] bg-[#0d0d11] [transform:translateZ(-34px)]`
  }
</script>

<main class="min-h-[100svh] overflow-hidden bg-[#08080a] text-[#e8e4db]">
  <ExperimentBack {navigate} />
  <ScenarioSwitch
    {scenario}
    onScenario={(next) => {
      scenarioId = next
      entered = ChainStage.Passkey
    }}
  />

  <section class="mx-auto max-w-2xl px-5 py-24 sm:px-8 sm:py-28">
    <p class="font-mono text-[11px] tracking-[0.28em] text-[#6a6a63] uppercase">
      Devices &amp; access
    </p>
    <h1 class="mt-5 text-3xl leading-tight font-light tracking-[-0.03em]">
      Three doors, one corridor
    </h1>
    <p class="mt-4 max-w-lg text-[15px] leading-7 text-[#8d8d85]">
      {prepared
        ? 'Each door only opens because the one outside it did. Walk into a door to read what is written on it.'
        : 'None of these doors has been built for this browser yet, so the corridor is drawn as an outline only.'}
    </p>
    <p
      class="mt-6 font-mono text-[11px] tracking-[0.18em] text-[#6a6a63] uppercase"
    >
      {scenario.protectionLabel} · {scenario.identityLabel}
    </p>

    <div class="mt-12 [perspective:1400px] [perspective-origin:50%_30%]">
      {#snippet door(index: number)}
        {@const stage = CHAIN_STAGES[index]}
        {@const active = stage === entered}
        {@const lit = prepared && active}
        {@const identifier = stageIdentifier(scenario, stage)}
        <div class={frameClass(stage)}>
          <button
            type="button"
            class="flex w-full items-start justify-between gap-4 text-left"
            aria-pressed={active}
            onclick={() => (entered = stage)}
          >
            <span class="flex min-w-0 items-start gap-3">
              {#if lit}
                <DoorOpen
                  class="mt-0.5 size-4 shrink-0 text-[#e8b473]"
                  aria-hidden="true"
                />
              {:else}
                <DoorClosed
                  class="mt-0.5 size-4 shrink-0 text-[#5d5d57]"
                  aria-hidden="true"
                />
              {/if}
              <span class="block min-w-0">
                <span
                  class="block font-mono text-[10px] tracking-[0.22em] text-[#6a6a63] uppercase"
                >
                  {depths[stage]} · {stageCaption(stage)}
                </span>
                <span
                  class={`mt-1.5 block truncate text-lg font-light ${active ? 'text-[#f3e9d8]' : 'text-[#b8b4ab]'}`}
                >
                  {stageTitle(scenario, stage)}
                </span>
              </span>
            </span>
            <span
              class={`shrink-0 font-mono text-[10px] tracking-[0.2em] uppercase ${lit ? 'text-[#e8b473]' : 'text-[#5d5d57]'}`}
            >
              {#if prepared}
                {active ? 'Inside' : 'Walk in'}
              {:else}
                {active ? 'Empty frame' : 'Unbuilt'}
              {/if}
            </span>
          </button>

          {#if active}
            <div
              class={`mt-5 border-t pt-5 ${lit ? 'border-[#2c2418]' : 'border-[#23232a]'}`}
            >
              <p
                class={`font-mono text-[10px] tracking-[0.2em] uppercase ${lit ? 'text-[#8a7a5f]' : 'text-[#6a6a63]'}`}
              >
                {stageQuestion(stage)}
              </p>
              <p class="mt-3 text-[14px] leading-7 text-[#b6b1a5]">
                {stageMeaning(stage)}
              </p>
              <p
                class={`mt-3 text-[12px] break-all ${
                  identifier.kind === FactKind.Known
                    ? 'font-mono text-[#e8b473]'
                    : 'text-[#6a6a63] italic'
                }`}
              >
                {factText(identifier)}
              </p>
              <dl class="mt-5">
                {#each stageEvidence(scenario, stage) as row (row.label)}
                  <div
                    class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#1e1a12] py-2.5"
                  >
                    <dt
                      class="font-mono text-[10px] tracking-[0.14em] text-[#6a6a63] uppercase"
                    >
                      {row.label}
                    </dt>
                    <dd
                      class={`min-w-0 text-[13px] ${
                        row.fact.kind === FactKind.Known
                          ? 'font-mono break-all text-[#ded7c9]'
                          : 'text-[#6a6a63] italic'
                      }`}
                    >
                      {factText(row.fact)}
                    </dd>
                  </div>
                {/each}
              </dl>
            </div>
          {/if}

          {#if index + 1 < CHAIN_STAGES.length}
            <p
              class="mt-6 font-mono text-[10px] tracking-[0.24em] text-[#5d5d57] uppercase"
              aria-hidden="true"
            >
              {prepared
                ? `↓ ${relationInto(CHAIN_STAGES[index + 1])}`
                : '↓ nothing yet'}
            </p>
            <div class="mt-3">
              {@render door(index + 1)}
            </div>
          {/if}
        </div>
      {/snippet}

      {@render door(0)}
    </div>

    {#if !prepared}
      <button
        type="button"
        class="mt-10 rounded-full bg-[#e8b473] px-6 py-3 text-sm font-medium text-[#14100a]"
      >
        Build the first door
      </button>
    {/if}
  </section>
</main>
