<!--
DIRECTION: Containment rather than sequence. Vaults sit at the centre, the
device key rings them, and the passkey is the outermost ring — what a person
presents on the outside, what stays protected on the inside. Pointing at a ring
swaps the readout beside it and names what would break that ring.
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
    stageQuestion,
    stageTitle,
    verifiedSummary,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  interface Ring {
    stage: ChainStage
    inset: string
    layer: string
  }

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let selected = $state(ChainStage.Passkey)
  let preview = $state(ChainStage.Passkey)
  let previewing = $state(false)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const active = $derived(previewing ? preview : selected)
  const identifier = $derived(stageIdentifier(scenario, active))

  const rings: Ring[] = [
    { stage: ChainStage.Passkey, inset: 'inset-0', layer: 'z-10' },
    { stage: ChainStage.DeviceKey, inset: 'inset-[17%]', layer: 'z-20' },
    { stage: ChainStage.Vaults, inset: 'inset-[34%]', layer: 'z-30' },
  ]

  const breakage: Record<ChainStage, string> = {
    [ChainStage.Passkey]:
      'Losing the manager this passkey lives in. Nook holds only a fingerprint, which can recognise the passkey but can never stand in for it.',
    [ChainStage.DeviceKey]:
      'Clearing this browser. The key exists nowhere else, so it would have to be derived again by presenting the passkey here.',
    [ChainStage.Vaults]:
      'Dropping this device key from a vault. Reachability is a record of an actual open, so the vault simply stops counting from here.',
  }

  function ringClass(ring: Ring): string {
    const base = `absolute ${ring.inset} ${ring.layer} rounded-full transition duration-300 motion-reduce:transition-none`
    if (!prepared) {
      return `${base} border border-dashed border-[#c9c4bb] bg-[#fbfbfa]`
    }
    return ring.stage === active
      ? `${base} border-2 border-[#0f6b63] bg-[#0f6b63]/[0.06]`
      : `${base} border border-[#cfcac0] bg-[#fbfbfa] hover:border-[#0f6b63]/50`
  }

  function point(stage: ChainStage) {
    preview = stage
    previewing = true
  }
</script>

<main class="min-h-[100svh] bg-[#fbfbfa] text-[#191b1a]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      selected = ChainStage.Passkey
      previewing = false
    }}
  />

  <section class="mx-auto max-w-5xl px-6 py-24">
    <p class="font-mono text-[11px] tracking-[0.24em] text-[#8c8a84] uppercase">
      Devices &amp; access
    </p>
    <h1 class="mt-5 text-3xl leading-tight font-light tracking-[-0.025em]">
      What surrounds what
    </h1>
    <p class="mt-4 max-w-xl text-[15px] leading-7 text-[#5f5d58]">
      The outer ring is what you present. The inner circle is what stays
      protected. Nothing reaches the centre except through every ring around it.
    </p>

    <div
      class="mt-14 grid items-start gap-14 lg:grid-cols-[minmax(0,21rem)_1fr]"
    >
      <div class="relative mx-auto aspect-square w-full max-w-[21rem]">
        {#each rings as ring (ring.stage)}
          <button
            type="button"
            class={ringClass(ring)}
            aria-pressed={ring.stage === selected}
            onclick={() => (selected = ring.stage)}
            onmouseenter={() => point(ring.stage)}
            onmouseleave={() => (previewing = false)}
            onfocus={() => point(ring.stage)}
            onblur={() => (previewing = false)}
          >
            {#if ring.stage === ChainStage.Vaults}
              <span
                class="flex h-full flex-col items-center justify-center px-4"
              >
                <span
                  class="font-mono text-[10px] tracking-[0.18em] text-[#8c8a84] uppercase"
                >
                  {stageCaption(ring.stage)}
                </span>
                <span class="mt-1 text-center text-sm leading-snug font-light">
                  {stageTitle(scenario, ring.stage)}
                </span>
                <span class="mt-1 text-center text-[11px] text-[#8c8a84]">
                  {verifiedSummary(scenario)}
                </span>
              </span>
            {:else}
              <span
                class="absolute inset-x-0 top-[4%] flex flex-col items-center gap-0.5 px-3"
              >
                <span
                  class="font-mono text-[10px] tracking-[0.18em] text-[#8c8a84] uppercase"
                >
                  {stageCaption(ring.stage)}
                </span>
                <span class="max-w-full truncate text-[12px] text-[#3d3b37]">
                  {stageTitle(scenario, ring.stage)}
                </span>
              </span>
            {/if}
          </button>
        {/each}
      </div>

      <div class="min-w-0">
        <p
          class="font-mono text-[10px] tracking-[0.22em] text-[#8c8a84] uppercase"
        >
          {stageQuestion(active)}
        </p>
        <h2 class="mt-3 text-2xl font-light tracking-[-0.02em]">
          {stageTitle(scenario, active)}
        </h2>
        <p
          class={`mt-2 text-[12px] break-all ${
            identifier.kind === FactKind.Known
              ? 'font-mono text-[#0f6b63]'
              : 'text-[#a3a099] italic'
          }`}
        >
          {factText(identifier)}
        </p>
        <p class="mt-5 max-w-xl text-[15px] leading-7 text-[#4a4844]">
          {stageMeaning(active)}
        </p>

        <div class="mt-6 border-l-2 border-[#0f6b63]/35 pl-4">
          <p
            class="font-mono text-[10px] tracking-[0.2em] text-[#8c8a84] uppercase"
          >
            What would break this ring
          </p>
          <p class="mt-2 max-w-xl text-[14px] leading-7 text-[#4a4844]">
            {breakage[active]}
          </p>
        </div>

        <dl class="mt-8 max-w-xl">
          {#each stageEvidence(scenario, active) as row (row.label)}
            <div
              class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#e6e3dc] py-2.5"
            >
              <dt class="text-[13px] text-[#8c8a84]">{row.label}</dt>
              <dd
                class={`min-w-0 text-[13px] ${
                  row.fact.kind === FactKind.Known
                    ? 'font-mono break-all text-[#26282a]'
                    : 'text-[#a3a099] italic'
                }`}
              >
                {factText(row.fact)}
              </dd>
            </div>
          {/each}
        </dl>

        {#if !prepared}
          <div
            class="mt-8 max-w-xl rounded-lg border border-dashed border-[#c9c4bb] px-5 py-4"
          >
            <p class="text-[14px] leading-7 text-[#5f5d58]">
              Every ring is drawn as an outline because none of them exists on
              this browser yet. Preparing it creates the outer ring first; the
              others can only form inside one that already holds.
            </p>
            <button
              type="button"
              class="mt-4 rounded-full bg-[#0f6b63] px-5 py-2.5 text-[13px] font-medium text-[#fbfbfa]"
            >
              Prepare this browser
            </button>
          </div>
        {/if}
      </div>
    </div>
  </section>
</main>
