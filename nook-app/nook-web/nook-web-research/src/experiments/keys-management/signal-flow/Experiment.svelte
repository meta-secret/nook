<!--
DIRECTION: A signal board. The three links are components soldered onto one
trace; a test pulse travels from the passkey socket toward the vault bus and
either arrives or stops at the first gap in the copper.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault, Zap } from '@lucide/svelte'
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
    stageTitle,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let probed = $state(ChainStage.Passkey)
  let runToken = $state(0)
  /** How many components the pulse has energized. 0 means the board is cold. */
  let reached = $state(0)
  let settled = $state(false)

  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const evidence = $derived(stageEvidence(scenario, probed))
  const identifier = $derived(stageIdentifier(scenario, probed))
  /** Without a passkey the copper is cut after the first socket. */
  const conducts = $derived(prepared ? CHAIN_STAGES.length : 1)
  const running = $derived(runToken > 0 && !settled)
  const energizedCount = $derived(prepared ? reached : 0)

  const stageIcons = {
    [ChainStage.Passkey]: Fingerprint,
    [ChainStage.DeviceKey]: Laptop,
    [ChainStage.Vaults]: Vault,
  }

  const STEP_MS = 520

  $effect(() => {
    const token = runToken
    if (token === 0) return
    const stops = conducts
    reached = 0
    settled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let step = 1; step <= stops; step += 1) {
      timers.push(setTimeout(() => (reached = step), step * STEP_MS))
    }
    timers.push(setTimeout(() => (settled = true), stops * STEP_MS + 240))
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  })

  function resetBoard(next: ScenarioId) {
    scenarioId = next
    probed = ChainStage.Passkey
    runToken = 0
    reached = 0
    settled = false
  }

  function live(index: number): boolean {
    return reached > index
  }

  function result(): string {
    if (!settled) return 'Board cold. Nothing is being tested.'
    if (!prepared) {
      return 'The pulse stops at the passkey socket. This browser has no passkey, so no device key exists and no vault can answer.'
    }
    return chainSentence(scenario)
  }
</script>

<main class="min-h-[100svh] bg-[#04070a] text-[#d5e4e2]">
  <ExperimentBack {navigate} />
  <ScenarioSwitch {scenario} onScenario={resetBoard} />

  <section class="mx-auto max-w-5xl px-5 py-20 sm:px-8">
    <p class="font-mono text-[10px] tracking-[0.32em] text-[#4a6b68] uppercase">
      Devices &amp; access · signal path
    </p>
    <h1 class="mt-3 text-2xl font-light tracking-[-0.02em] sm:text-3xl">
      One trace, three components
    </h1>
    <p class="mt-3 max-w-xl text-sm leading-6 text-[#7c948f]">
      Send a test pulse down the board. Every component it lights is a link that
      really exists on this browser.
    </p>

    <div class="mt-10 grid gap-8 lg:grid-cols-[19rem_1fr]">
      <div
        class="rounded-lg border border-[#12242a] bg-[#070d10] p-5 shadow-[inset_0_1px_0_#14282e]"
      >
        {#each CHAIN_STAGES as stage, index (stage)}
          {@const Icon = stageIcons[stage]}
          {@const energized = prepared && live(index)}
          {@const faulted = !prepared && index === 0 && live(0)}
          {@const probing = probed === stage}
          {#if index > 0}
            {@const segmentOn = prepared && live(index)}
            <div class="flex items-center gap-3 pl-5">
              <svg
                viewBox="0 0 24 56"
                class="h-14 w-6 shrink-0"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M12 0 V14 L4 24 V42 L12 52 V56"
                  fill="none"
                  stroke-width="1.25"
                  class={prepared
                    ? 'stroke-[#173139]'
                    : 'stroke-[#1d2b30] [stroke-dasharray:3_4]'}
                />
                {#if prepared}
                  <path
                    d="M12 0 V14 L4 24 V42 L12 52 V56"
                    fill="none"
                    stroke-width="1.75"
                    pathLength="1"
                    class="stroke-[#2dd4bf] transition-[stroke-dashoffset] duration-[480ms] ease-linear [stroke-dasharray:1] motion-reduce:duration-0"
                    style={`stroke-dashoffset: ${segmentOn ? 0 : 1}`}
                  />
                {/if}
                <circle
                  cx="4"
                  cy="24"
                  r="1.9"
                  class={segmentOn ? 'fill-[#2dd4bf]' : 'fill-[#1c353c]'}
                />
              </svg>
              <span
                class={`font-mono text-[10px] tracking-[0.24em] uppercase ${segmentOn ? 'text-[#2dd4bf]' : 'text-[#3f5d5b]'}`}
              >
                {relationInto(stage)}
              </span>
            </div>
          {/if}

          <button
            type="button"
            aria-pressed={probing}
            class={`flex w-full items-start gap-3 rounded-md border px-4 py-3 text-left transition duration-300 motion-reduce:transition-none ${
              energized
                ? 'border-[#2dd4bf]/55 bg-[#08191b] shadow-[0_0_22px_-8px_#2dd4bf]'
                : faulted
                  ? 'border-[#e0a35c]/60 bg-[#150f07]'
                  : prepared
                    ? 'border-[#12242a] bg-[#080f12]'
                    : 'border-dashed border-[#1d2b30] bg-transparent'
            } ${probing ? 'ring-1 ring-[#2dd4bf]/35' : 'hover:border-[#23444c]'}`}
            onclick={() => (probed = stage)}
          >
            <Icon
              class={`mt-0.5 size-4 shrink-0 ${energized ? 'text-[#2dd4bf]' : faulted ? 'text-[#e0a35c]' : 'text-[#3f5d5b]'}`}
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span
                class="flex items-baseline justify-between gap-2 font-mono text-[10px] tracking-[0.2em] text-[#4a6b68] uppercase"
              >
                {stageCaption(stage)}
                <span>U{index + 1}</span>
              </span>
              <span class="mt-1 block truncate text-sm text-[#d5e4e2]">
                {stageTitle(scenario, stage)}
              </span>
            </span>
          </button>
        {/each}

        <div class="mt-5 border-t border-dashed border-[#12242a] pt-4">
          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-md bg-[#2dd4bf] px-4 py-2.5 text-xs font-semibold tracking-[0.12em] text-[#04211f] uppercase transition hover:bg-[#5ee7d6] motion-reduce:transition-none"
            onclick={() => (runToken += 1)}
          >
            <Zap class="size-3.5" aria-hidden="true" />
            {running ? 'Pulse in flight' : 'Test this chain'}
          </button>
          <p
            class="mt-3 font-mono text-[10px] leading-5 tracking-[0.14em] text-[#4a6b68] uppercase"
          >
            {energizedCount} of {CHAIN_STAGES.length} components energized
          </p>
        </div>
      </div>

      <div class="min-w-0 space-y-6">
        <div
          class={`rounded-lg border px-5 py-4 transition duration-300 motion-reduce:transition-none ${
            settled
              ? prepared
                ? 'border-[#2dd4bf]/40 bg-[#07171a]'
                : 'border-[#e0a35c]/40 bg-[#130e07]'
              : 'border-[#12242a] bg-[#070d10]'
          }`}
        >
          <p
            class="font-mono text-[10px] tracking-[0.24em] text-[#4a6b68] uppercase"
          >
            Test result
          </p>
          <p class="mt-2 text-sm leading-6 text-[#c2d6d3]">{result()}</p>
        </div>

        <div class="rounded-lg border border-[#12242a] bg-[#070d10] p-5">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <h2 class="text-base font-light">
              {stageCaption(probed)} · probe
            </h2>
            {#if identifier.kind === FactKind.Known}
              <p class="font-mono text-[11px] break-all text-[#5f8580]">
                {identifier.value}
              </p>
            {:else}
              <p class="text-[11px] text-[#4a6b68] italic">
                {identifier.reason}
              </p>
            {/if}
          </div>
          <p class="mt-3 text-sm leading-6 text-[#7c948f]">
            {stageMeaning(probed)}
          </p>
          <dl
            class="mt-5 space-y-px overflow-hidden rounded border border-[#12242a]"
          >
            {#each evidence as row (row.label)}
              <div
                class="flex flex-wrap items-baseline justify-between gap-3 bg-[#0a1215] px-4 py-2.5"
              >
                <dt
                  class="font-mono text-[10px] tracking-[0.14em] text-[#4a6b68] uppercase"
                >
                  {row.label}
                </dt>
                <dd
                  class={`min-w-0 text-sm ${row.fact.kind === FactKind.Known ? 'font-mono break-all text-[#c2d6d3]' : 'text-[#4a6b68] italic'}`}
                >
                  {factText(row.fact)}
                </dd>
              </div>
            {/each}
          </dl>
        </div>

        <p
          class="font-mono text-[10px] leading-5 tracking-[0.14em] text-[#3f5d5b] uppercase"
        >
          {scenario.device.boundary}
        </p>
      </div>
    </div>
  </section>
</main>
