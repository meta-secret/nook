<!--
DIRECTION: No drilling. Three custody lanes stand side by side so the reader
compares columns instead of opening panels; cross-lane connectors carry the
derivation verbs, and the lane you focus is raised rather than isolated.
-->
<script lang="ts">
  import { Fingerprint, Laptop, ShieldCheck, Vault } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    CHAIN_STAGES,
    ChainStage,
    deviceKeyEvidence,
    type EvidenceRow,
    FactKind,
    factText,
    isPrepared,
    known,
    passkeyEvidence,
    passkeyRawEvidence,
    relationInto,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageIdentifier,
    stageQuestion,
    stageTitle,
    vaultEvidence,
    VaultTrust,
    verifiedSummary,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let focused = $state(ChainStage.DeviceKey)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  const laneIcons = {
    [ChainStage.Passkey]: Fingerprint,
    [ChainStage.DeviceKey]: Laptop,
    [ChainStage.Vaults]: Vault,
  }

  function laneRows(stage: ChainStage, raised: boolean): EvidenceRow[] {
    if (stage === ChainStage.Passkey) {
      return raised
        ? [...passkeyEvidence(scenario), ...passkeyRawEvidence(scenario)]
        : passkeyEvidence(scenario)
    }
    return [
      ...deviceKeyEvidence(scenario),
      { label: 'Boundary', fact: known(scenario.device.boundary) },
    ]
  }
</script>

{#snippet factCard(row: EvidenceRow)}
  <li class="rounded border border-[#dbe4ec] bg-[#fbfdff] px-3 py-2">
    <p class="font-mono text-[9px] tracking-[0.18em] text-[#7e8f9f] uppercase">
      {row.label}
    </p>
    <p
      class={`mt-1 text-[13px] leading-5 ${row.fact.kind === FactKind.Known ? 'font-mono break-words text-[#141a21]' : 'break-words text-[#8494a4] italic'}`}
    >
      {factText(row.fact)}
    </p>
  </li>
{/snippet}

<main class="min-h-[100svh] bg-[#eef2f6] text-[#141a21]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch {scenario} light onScenario={(next) => (scenarioId = next)} />

  <section class="mx-auto max-w-6xl px-5 py-20 sm:px-6">
    <header class="max-w-2xl">
      <p
        class="font-mono text-[11px] tracking-[0.24em] text-[#6c7f92] uppercase"
      >
        Devices &amp; access
      </p>
      <h1 class="mt-4 text-3xl font-light tracking-[-0.02em] sm:text-4xl">
        Custody, lane by lane
      </h1>
      <p class="mt-4 text-sm leading-6 text-[#5d6b7a]">
        Each lane holds only what it can prove on its own. Nothing is hidden
        behind a tab — raise a lane to see everything it reports, and read the
        verb in the gap to see what the lane on its left hands over.
      </p>
    </header>

    <div class="mt-12 grid gap-6 lg:grid-cols-3">
      {#each CHAIN_STAGES as stage, index (stage)}
        {@const Icon = laneIcons[stage]}
        {@const raised = focused === stage}
        {@const identifier = stageIdentifier(scenario, stage)}
        <section
          class={`flex flex-col transition duration-300 ${raised ? '-translate-y-1' : ''}`}
        >
          <div class="mb-3 flex h-5 items-center gap-2">
            {#if index > 0}
              <span
                class="hidden h-px w-6 flex-none bg-[#9db0c4] lg:-ml-6 lg:block"
                aria-hidden="true"
              ></span>
              <span class="text-[#4c6a88] lg:hidden" aria-hidden="true">↓</span>
              <span
                class="font-mono text-[10px] tracking-[0.2em] text-[#4c6a88] uppercase"
              >
                {relationInto(stage)}
              </span>
              <span
                class={`h-px flex-1 ${prepared ? 'bg-[#9db0c4]' : 'bg-[repeating-linear-gradient(to_right,#9db0c4_0_4px,transparent_4px_9px)]'}`}
                aria-hidden="true"
              ></span>
              <span
                class="text-[10px] leading-none text-[#4c6a88]"
                aria-hidden="true"
              >
                ▶
              </span>
            {/if}
          </div>

          <div
            class={`flex flex-1 flex-col rounded-r-lg border-l-2 p-5 transition ${
              raised
                ? 'border-[#2f4f6f] bg-white shadow-[0_18px_40px_rgb(20_38_60/0.12)]'
                : 'border-[#c3d0dd] bg-[#f7fafc]'
            }`}
          >
            <button
              type="button"
              class="block w-full text-left"
              aria-pressed={raised}
              onclick={() => (focused = stage)}
            >
              <span
                class="flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] text-[#6c7f92] uppercase"
              >
                <Icon class="size-3.5" aria-hidden="true" />
                {stageCaption(stage)}
              </span>
              <span class="mt-2 block text-lg leading-6 break-words">
                {stageTitle(scenario, stage)}
              </span>
              <span class="mt-1 block text-[11px] text-[#6c7f92]">
                {stageQuestion(stage)}
              </span>
              {#if identifier.kind === FactKind.Known}
                <span
                  class="mt-3 block rounded bg-[#e7eef5] px-2 py-1.5 font-mono text-[11px] break-all text-[#2f4f6f]"
                >
                  {identifier.value}
                </span>
              {:else}
                <span
                  class="mt-3 block rounded border border-dashed border-[#c3d0dd] px-2 py-1.5 text-[11px] text-[#8494a4] italic"
                >
                  {identifier.reason}
                </span>
              {/if}
            </button>

            <ul class="mt-5 space-y-2">
              {#if stage === ChainStage.Vaults}
                {#if scenario.vaults.length === 0}
                  <li
                    class="rounded border border-dashed border-[#c3d0dd] px-3 py-3 text-[13px] leading-5 text-[#8494a4] italic"
                  >
                    This device key has not opened a vault, so this lane stays
                    empty.
                  </li>
                {:else}
                  {#each scenario.vaults as vault (vault.id)}
                    <li
                      class="rounded border border-[#dbe4ec] bg-[#fbfdff] px-3 py-3"
                    >
                      <p class="flex items-center gap-2 text-sm">
                        {#if vault.trust === VaultTrust.Verified}
                          <ShieldCheck
                            class="size-3.5 shrink-0 text-[#2f6f52]"
                            aria-hidden="true"
                          />
                        {/if}
                        <span class="min-w-0 break-words">{vault.label}</span>
                      </p>
                      <dl class="mt-2 space-y-1">
                        {#each vaultEvidence(vault) as row (row.label)}
                          <div
                            class="flex flex-wrap items-baseline justify-between gap-2"
                          >
                            <dt
                              class="font-mono text-[9px] tracking-[0.16em] text-[#7e8f9f] uppercase"
                            >
                              {row.label}
                            </dt>
                            <dd
                              class={`text-[12px] ${row.fact.kind === FactKind.Known ? 'font-mono break-all' : 'text-[#8494a4] italic'}`}
                            >
                              {factText(row.fact)}
                            </dd>
                          </div>
                        {/each}
                      </dl>
                    </li>
                  {/each}
                {/if}
              {:else}
                {#each laneRows(stage, raised) as row (row.label)}
                  {@render factCard(row)}
                {/each}
              {/if}
            </ul>

            {#if stage === ChainStage.Vaults}
              <p
                class="mt-4 border-t border-[#dbe4ec] pt-3 text-[11px] text-[#6c7f92]"
              >
                {verifiedSummary(scenario)} · a vault counts as reachable only once
                this device key has opened it.
              </p>
            {/if}
          </div>
        </section>
      {/each}
    </div>

    {#if !prepared}
      <p
        class="mt-10 rounded border-l-2 border-dashed border-[#9db0c4] bg-white px-5 py-4 text-sm leading-6 text-[#5d6b7a]"
      >
        All three lanes are empty on purpose. Until this browser is prepared
        there is no passkey to present, no device key derived from it, and
        nothing a vault could have been opened by.
      </p>
    {/if}
  </section>
</main>
