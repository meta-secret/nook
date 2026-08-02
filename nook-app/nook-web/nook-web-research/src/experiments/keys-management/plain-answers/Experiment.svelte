<!--
DIRECTION: No diagram at all, and no schematic vocabulary. The screen is a
support answer page: the three questions are literal headings, each gets one
plain sentence, and the machine evidence is folded away behind a disclosure so
the page reads calmly from top to bottom.
-->
<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    type AccessScenario,
    CHAIN_STAGES,
    ChainStage,
    type EvidenceRow,
    FactKind,
    factText,
    isPrepared,
    passkeyRawEvidence,
    ScenarioId,
    scenarioById,
    stageEvidence,
    stageMeaning,
    stageQuestion,
    verifiedSummary,
    verifiedVaults,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let openStages = $state<ChainStage[]>([])
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  function toggle(stage: ChainStage) {
    openStages = openStages.includes(stage)
      ? openStages.filter((open) => open !== stage)
      : [...openStages, stage]
  }

  function vaultList(current: AccessScenario): string {
    const names = verifiedVaults(current).map((vault) => vault.label)
    return names.length === 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`
  }

  function answer(current: AccessScenario, stage: ChainStage): string {
    if (stage === ChainStage.Passkey) {
      return isPrepared(current)
        ? `Your ${factText(current.passkey.name)} passkey, saved in ${factText(current.passkey.savedIn)}. It stays inside that manager — Nook keeps only a short fingerprint of it, which is enough to recognise the same passkey again and nothing more.`
        : 'Nothing yet. No passkey has been created for this browser, so there is nothing to present and nothing for Nook to recognise.'
    }
    if (stage === ChainStage.DeviceKey) {
      return isPrepared(current)
        ? `A device key that exists only in this browser — ${current.device.browser} on ${current.device.platform}. Presenting the passkey unlocks it, and it is the key that actually decrypts vault data here.`
        : `No device key exists in this ${current.device.browser} yet. One is derived the first time a passkey unlocks this browser, and it stays here afterwards.`
    }
    if (current.vaults.length === 0) {
      return 'No vault. Nothing has been opened from this browser, so there is nothing this device key is proven to reach.'
    }
    const verified = verifiedVaults(current)
    if (verified.length === 0) {
      return 'None of them, so far. The vaults known to this browser have not been opened by this device key, so none of them counts as reachable from here.'
    }
    return `${vaultList(current)}. A vault is counted here only once this device key has actually opened it, which today means ${verifiedSummary(current).toLocaleLowerCase()}.`
  }

  function rows(current: AccessScenario, stage: ChainStage): EvidenceRow[] {
    return stage === ChainStage.Passkey
      ? [...stageEvidence(current, stage), ...passkeyRawEvidence(current)]
      : stageEvidence(current, stage)
  }
</script>

<main class="min-h-[100svh] bg-[#faf8f4] text-[#1b1a17]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      openStages = []
    }}
  />

  <article class="mx-auto max-w-[42rem] px-6 py-24 sm:py-32">
    <p class="font-mono text-[11px] tracking-[0.24em] text-[#8f897d] uppercase">
      Devices &amp; access
    </p>
    <h1
      class="mt-7 font-serif text-[2.1rem] leading-[1.25] font-light tracking-[-0.02em] sm:text-[2.75rem]"
    >
      Three questions about this browser.
    </h1>
    <p class="mt-7 max-w-[34rem] text-[17px] leading-8 text-[#5c5850]">
      {prepared
        ? 'Everything on this page describes this browser only. Answers first, then the exact records they came from.'
        : 'This browser has not been prepared, so two of these answers are honestly empty. Nothing is hidden and nothing is assumed.'}
    </p>

    <div class="mt-16">
      {#each CHAIN_STAGES as stage (stage)}
        {@const open = openStages.includes(stage)}
        <section class="border-t border-[#e4e0d6] py-12">
          <h2
            class="font-serif text-[1.6rem] leading-snug font-normal sm:text-[1.8rem]"
          >
            {stageQuestion(stage)}
          </h2>
          <p class="mt-5 max-w-[34rem] text-[17px] leading-8 text-[#302e29]">
            {answer(scenario, stage)}
          </p>
          <p class="mt-4 max-w-[34rem] text-[15px] leading-7 text-[#807a6e]">
            {stageMeaning(stage)}
          </p>

          <button
            type="button"
            class="mt-7 flex items-center gap-2.5 rounded-full border border-[#d9d4c7] px-4 py-2 text-[13px] text-[#4a4740] transition hover:border-[#1b1a17] motion-reduce:transition-none"
            aria-expanded={open}
            aria-controls={`evidence-${stage}`}
            onclick={() => toggle(stage)}
          >
            {#if open}
              <Minus class="size-3.5" aria-hidden="true" />
              Hide the records
            {:else}
              <Plus class="size-3.5" aria-hidden="true" />
              What is this based on?
            {/if}
          </button>

          <div id={`evidence-${stage}`}>
            {#if open}
              <dl class="mt-6 max-w-[34rem] border-t border-[#e4e0d6]">
                {#each rows(scenario, stage) as row (row.label)}
                  <div
                    class="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-[#eeebe2] py-3"
                  >
                    <dt class="text-[13px] text-[#8f897d]">{row.label}</dt>
                    <dd
                      class={`min-w-0 text-[13px] ${
                        row.fact.kind === FactKind.Known
                          ? 'font-mono break-all text-[#302e29]'
                          : 'text-[#a09a8d] italic'
                      }`}
                    >
                      {factText(row.fact)}
                    </dd>
                  </div>
                {/each}
              </dl>
            {/if}
          </div>
        </section>
      {/each}
    </div>

    {#if prepared}
      <p
        class="border-t border-[#e4e0d6] pt-10 text-[15px] leading-7 text-[#807a6e]"
      >
        Still unsure about something here? Every line above is read from this
        browser and from the vaults it has opened. Nook cannot see your passkey
        itself, and it cannot read a vault this device key has never opened.
      </p>
    {:else}
      <div class="border-t border-[#e4e0d6] pt-10">
        <p class="max-w-[34rem] text-[15px] leading-7 text-[#807a6e]">
          Preparing this browser creates a passkey in the manager you choose,
          derives a device key that stays here, and only then can a vault be
          opened from this browser.
        </p>
        <button
          type="button"
          class="mt-6 rounded-full bg-[#1b1a17] px-6 py-3 text-sm font-medium text-[#faf8f4]"
        >
          Prepare this browser
        </button>
      </div>
    {/if}
  </article>
</main>
