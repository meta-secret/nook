<!--
DIRECTION: A drafted sheet, not a designed screen. The three links are plan
elements with leader lines and balloon callouts; the evidence lives in the
margin; a title block in the corner carries the status of the drawing.
-->
<script lang="ts">
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
    verifiedSummary,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let detailed = $state(ChainStage.DeviceKey)

  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  const GRID =
    '[background-image:linear-gradient(to_right,#0d2c46_1px,transparent_1px),linear-gradient(to_bottom,#0d2c46_1px,transparent_1px)] [background-size:26px_26px]'

  function elementCode(index: number): string {
    return `A-${String(index + 1).padStart(2, '0')}`
  }
</script>

<main class={`min-h-[100svh] bg-[#061423] text-[#cfe9f7] ${GRID}`}>
  <ExperimentBack {navigate} />
  <ScenarioSwitch {scenario} onScenario={(next) => (scenarioId = next)} />

  <section class="mx-auto max-w-5xl px-5 py-20 sm:px-8">
    <div class="border border-[#1d5c86] bg-[#061423]/80">
      <header
        class="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#1d5c86] px-5 py-3 font-mono text-[10px] tracking-[0.22em] text-[#4d8fb5] uppercase"
      >
        <span>Nook · devices &amp; access</span>
        <span>Plan of access · sheet 1 of 1</span>
      </header>

      <div class="grid gap-0 lg:grid-cols-[1fr_17rem]">
        <div
          class="border-b border-[#123f60] px-5 py-8 lg:border-r lg:border-b-0"
        >
          {#each CHAIN_STAGES as stage, index (stage)}
            {@const active = detailed === stage}
            {@const identifier = stageIdentifier(scenario, stage)}
            {#if index > 0}
              <div class="flex items-center gap-2 py-3 pl-8">
                <span class="h-px flex-1 bg-[#1d5c86]"></span>
                <span
                  class="font-mono text-[9px] tracking-[0.26em] text-[#4d8fb5] uppercase"
                >
                  {relationInto(stage)}
                </span>
                <span class="h-px flex-1 bg-[#1d5c86]"></span>
                <span class="w-[3.25rem] shrink-0"></span>
              </div>
            {/if}

            <div class="flex items-stretch gap-0">
              <div class="relative w-8 shrink-0">
                <span
                  class="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-[#1d5c86]"
                ></span>
                <span
                  class="absolute top-0 left-1/2 h-px w-4 -translate-x-1/2 bg-[#1d5c86]"
                ></span>
                <span
                  class="absolute bottom-0 left-1/2 h-px w-4 -translate-x-1/2 bg-[#1d5c86]"
                ></span>
                <span
                  class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#061423] py-1 font-mono text-[9px] tracking-[0.18em] text-[#4d8fb5] [writing-mode:vertical-rl]"
                >
                  {elementCode(index)}
                </span>
              </div>

              <button
                type="button"
                aria-pressed={active}
                class={`relative min-w-0 flex-1 border px-4 py-4 text-left transition ${
                  active
                    ? 'border-[#7fd4f5] bg-[#0b2337]'
                    : prepared
                      ? 'border-[#1d5c86] hover:border-[#3f89b3]'
                      : 'border-dashed border-[#1d5c86] hover:border-[#3f89b3]'
                }`}
                onclick={() => (detailed = stage)}
              >
                <span
                  class="block font-mono text-[9px] tracking-[0.24em] text-[#4d8fb5] uppercase"
                >
                  {stageCaption(stage)}
                </span>
                <span
                  class="mt-1.5 block text-lg leading-tight font-light break-words"
                >
                  {stageTitle(scenario, stage)}
                </span>
                {#if identifier.kind === FactKind.Known}
                  <span
                    class="mt-1 block font-mono text-[11px] break-all text-[#6aa8c9]"
                  >
                    {identifier.value}
                  </span>
                {:else}
                  <span class="mt-1 block text-[11px] text-[#3f6f8d] italic">
                    {identifier.reason}
                  </span>
                {/if}
                <span
                  class="absolute -top-px -left-px size-2 border-t border-l border-[#7fd4f5]"
                  aria-hidden="true"
                ></span>
                <span
                  class="absolute -right-px -bottom-px size-2 border-r border-b border-[#7fd4f5]"
                  aria-hidden="true"
                ></span>
              </button>

              <div class="flex w-[3.25rem] shrink-0 items-center">
                <span class="h-px flex-1 bg-[#1d5c86]"></span>
                <span
                  class={`grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] ${active ? 'border-[#7fd4f5] text-[#7fd4f5]' : 'border-[#1d5c86] text-[#4d8fb5]'}`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              </div>
            </div>
          {/each}

          <p
            class="mt-8 max-w-lg border-l border-[#1d5c86] pl-4 font-mono text-[10px] leading-5 tracking-[0.08em] text-[#4d8fb5] uppercase"
          >
            {scenario.device.boundary}
          </p>
        </div>

        <aside class="min-w-0 px-5 py-8">
          <p
            class="font-mono text-[9px] tracking-[0.26em] text-[#4d8fb5] uppercase"
          >
            Margin notes
          </p>

          {#each CHAIN_STAGES as stage, index (stage)}
            {@const active = detailed === stage}
            <div class="mt-4 border-t border-[#123f60] pt-3">
              <p
                class="flex items-baseline gap-2 font-mono text-[10px] text-[#6aa8c9]"
              >
                <span
                  class={`grid size-4 shrink-0 place-items-center rounded-full border text-[8px] ${active ? 'border-[#7fd4f5] text-[#7fd4f5]' : 'border-[#1d5c86]'}`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span class="tracking-[0.16em] uppercase"
                  >{stageCaption(stage)}</span
                >
              </p>
              <p class="mt-2 text-[11px] leading-5 text-[#7fb4d2]">
                {stageQuestion(stage)}
              </p>
              {#if active}
                <p class="mt-2 text-[11px] leading-5 text-[#9fd0e8]">
                  {stageMeaning(stage)}
                </p>
                <dl class="mt-3">
                  {#each stageEvidence(scenario, stage) as row (row.label)}
                    <div
                      class="flex flex-wrap items-baseline justify-between gap-2 py-1"
                    >
                      <dt
                        class="font-mono text-[9px] tracking-[0.14em] text-[#4d8fb5] uppercase"
                      >
                        {row.label}
                      </dt>
                      <dd
                        class={`min-w-0 text-[10px] ${row.fact.kind === FactKind.Known ? 'font-mono break-all text-[#cfe9f7]' : 'text-[#3f6f8d] italic'}`}
                      >
                        {factText(row.fact)}
                      </dd>
                    </div>
                  {/each}
                </dl>
              {/if}
            </div>
          {/each}
        </aside>
      </div>

      <div
        class="grid border-t border-[#1d5c86] font-mono text-[10px] sm:grid-cols-[1.4fr_1fr_1fr]"
      >
        <div
          class="border-b border-[#123f60] px-5 py-3 sm:border-r sm:border-b-0"
        >
          <p class="tracking-[0.22em] text-[#4d8fb5] uppercase">Drawing</p>
          <p class="mt-1 text-[#cfe9f7]">Access chain, this browser</p>
          <p class="mt-1 tracking-[0.14em] text-[#4d8fb5] uppercase">
            Rev · {scenario.label}
          </p>
        </div>
        <div
          class="border-b border-[#123f60] px-5 py-3 sm:border-r sm:border-b-0"
        >
          <p class="tracking-[0.22em] text-[#4d8fb5] uppercase">Status</p>
          <p class="mt-1 text-[#cfe9f7]">{scenario.identityLabel}</p>
          <p class="mt-1 tracking-[0.14em] text-[#4d8fb5] uppercase">
            {scenario.protectionLabel}
          </p>
        </div>
        <div class="px-5 py-3">
          <p class="tracking-[0.22em] text-[#4d8fb5] uppercase">
            Verified vaults
          </p>
          <p class="mt-1 text-[#cfe9f7]">{verifiedSummary(scenario)}</p>
          <p class="mt-1 tracking-[0.14em] text-[#4d8fb5] uppercase">
            Prepared · {factText(scenario.device.preparedAt)}
          </p>
        </div>
      </div>
    </div>

    {#if !prepared}
      <p
        class="mt-6 max-w-2xl border border-dashed border-[#1d5c86] px-5 py-4 font-mono text-[10px] leading-5 tracking-[0.12em] text-[#4d8fb5] uppercase"
      >
        Elements shown dashed are not built. Prepare this browser and the
        passkey, the device key and the vaults it opens become drawn work.
      </p>
    {/if}
  </section>
</main>
