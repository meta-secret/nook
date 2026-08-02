<!--
DIRECTION: One continuous rail, read top to bottom. The relation verb rides on
the drawn line between stops, and opening a stop expands its evidence inside the
rail, so the whole chain stays visible while you read a single link.
-->
<script lang="ts">
  import { ChevronDown } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    CHAIN_STAGES,
    ChainStage,
    chainSentence,
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
  let scenarioId = $state(ScenarioId.Shared)
  let openStage = $state(ChainStage.Passkey)
  let expanded = $state(true)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  function isOpen(stage: ChainStage): boolean {
    return expanded && stage === openStage
  }

  function toggle(stage: ChainStage) {
    if (isOpen(stage)) {
      expanded = false
      return
    }
    openStage = stage
    expanded = true
  }

  function selectScenario(next: ScenarioId) {
    scenarioId = next
    openStage = ChainStage.Passkey
    expanded = true
  }
</script>

<main class="min-h-[100svh] bg-[#f4f3ee] text-[#16181d]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch {scenario} light onScenario={selectScenario} />

  <section class="mx-auto max-w-3xl px-5 py-24 sm:px-8 sm:py-28">
    <p class="font-mono text-[11px] tracking-[0.24em] text-[#8b8676] uppercase">
      Devices &amp; access
    </p>
    <h1 class="mt-6 text-3xl leading-tight font-light tracking-[-0.025em]">
      One chain, three stops
    </h1>
    <p class="mt-5 max-w-xl text-[15px] leading-7 text-[#5b5749]">
      {chainSentence(scenario)}
    </p>

    <ol class="mt-14 list-none">
      {#each CHAIN_STAGES as stage, index (stage)}
        {@const open = isOpen(stage)}
        {@const identifier = stageIdentifier(scenario, stage)}

        {#if index > 0}
          <li class="flex" aria-hidden="true">
            <div class="flex w-12 shrink-0 justify-center sm:w-14">
              <div
                class={`relative h-24 ${
                  prepared
                    ? 'w-px bg-[#1f3a5f]/35'
                    : 'w-0 border-l border-dashed border-[#b5b0a0]'
                }`}
              >
                <span
                  class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#f4f3ee] px-1 py-2 font-mono text-[10px] tracking-[0.24em] text-[#8b8676] uppercase [writing-mode:vertical-rl]"
                >
                  {relationInto(stage)}
                </span>
              </div>
            </div>
          </li>
        {/if}

        <li class="flex gap-4 sm:gap-6">
          <div class="flex w-12 shrink-0 justify-center pt-6 sm:w-14">
            <span
              class={`size-3.5 rounded-full border-2 ${
                prepared
                  ? open
                    ? 'border-[#1f3a5f] bg-[#1f3a5f]'
                    : 'border-[#1f3a5f]/45 bg-[#f4f3ee]'
                  : 'border-dashed border-[#b5b0a0] bg-[#f4f3ee]'
              }`}
              aria-hidden="true"
            ></span>
          </div>

          <div class="min-w-0 flex-1">
            <button
              type="button"
              class="flex w-full items-start justify-between gap-4 border-b border-[#ddd9cc] py-5 text-left transition hover:border-[#1f3a5f]/50 motion-reduce:transition-none"
              aria-expanded={open}
              aria-controls={`rail-${stage}`}
              onclick={() => toggle(stage)}
            >
              <span class="block min-w-0">
                <span
                  class="block font-mono text-[10px] tracking-[0.22em] text-[#8b8676] uppercase"
                >
                  {stageCaption(stage)}
                </span>
                <span class="mt-2 block truncate text-xl font-light">
                  {stageTitle(scenario, stage)}
                </span>
                <span
                  class={`mt-1.5 block text-[12px] break-all ${
                    identifier.kind === FactKind.Known
                      ? 'font-mono text-[#6d6858]'
                      : 'text-[#a49e8d] italic'
                  }`}
                >
                  {factText(identifier)}
                </span>
              </span>
              <ChevronDown
                class={`mt-1 size-4 shrink-0 text-[#8b8676] transition motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            <div id={`rail-${stage}`}>
              {#if open}
                <div class="pt-6 pb-10">
                  <p
                    class="font-mono text-[10px] tracking-[0.2em] text-[#8b8676] uppercase"
                  >
                    {stageQuestion(stage)}
                  </p>
                  <p class="mt-3 max-w-xl text-[15px] leading-7 text-[#4c4839]">
                    {stageMeaning(stage)}
                  </p>
                  <dl class="mt-6 max-w-xl">
                    {#each stageEvidence(scenario, stage) as row (row.label)}
                      <div
                        class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#e5e1d5] py-2.5"
                      >
                        <dt class="text-[13px] text-[#8b8676]">{row.label}</dt>
                        <dd
                          class={`min-w-0 text-[13px] ${
                            row.fact.kind === FactKind.Known
                              ? 'font-mono break-all text-[#2b2d33]'
                              : 'text-[#a49e8d] italic'
                          }`}
                        >
                          {factText(row.fact)}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                </div>
              {:else}
                <div class="pb-10"></div>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ol>

    {#if prepared}
      <p
        class="ml-16 max-w-xl border-l-2 border-[#1f3a5f]/25 pl-5 text-[13px] leading-6 text-[#7a7565] sm:ml-20"
      >
        The rail is only as long as the evidence. A stop below the device key
        appears once that key has opened the vault at least once from this
        browser.
      </p>
    {:else}
      <div
        class="ml-16 max-w-xl border-l-2 border-dashed border-[#b5b0a0] pl-5 sm:ml-20"
      >
        <p class="text-[13px] leading-6 text-[#7a7565]">
          The line is drawn dashed because none of these links exist yet.
          Preparing this browser creates the passkey, derives the device key
          that stays here, and only then can a vault sit at the bottom of the
          rail.
        </p>
        <button
          type="button"
          class="mt-5 rounded-full bg-[#1f3a5f] px-5 py-2.5 text-[13px] font-medium text-[#f4f3ee]"
        >
          Prepare this browser
        </button>
      </div>
    {/if}
  </section>
</main>
