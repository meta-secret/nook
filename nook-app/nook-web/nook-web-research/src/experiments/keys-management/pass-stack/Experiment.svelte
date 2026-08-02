<!--
DIRECTION: The chain as a wallet of boarding passes. Every link is a perforated
pass whose stub carries the single identifier it owns; pulling a pass to the
front opens its body. Vaults ride along as extra stubs on the third pass.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault } from '@lucide/svelte'
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
    VaultTrust,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let order = $state<ChainStage[]>([...CHAIN_STAGES])
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  const stageIcons = {
    [ChainStage.Passkey]: Fingerprint,
    [ChainStage.DeviceKey]: Laptop,
    [ChainStage.Vaults]: Vault,
  }

  function pull(stage: ChainStage) {
    order = [stage, ...order.filter((entry) => entry !== stage)]
  }

  function depthClass(position: number): string {
    if (position === 0) {
      return 'z-30 shadow-[0_20px_44px_rgb(84_62_34/0.22)]'
    }
    if (position === 1) {
      return 'z-20 -mt-7 ml-3 shadow-[0_12px_28px_rgb(84_62_34/0.16)]'
    }
    return 'z-10 -mt-7 ml-6 shadow-[0_8px_18px_rgb(84_62_34/0.12)]'
  }
</script>

<main class="min-h-[100svh] bg-[#ece2d0] text-[#2c2620]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      order = [...CHAIN_STAGES]
    }}
  />

  <section class="mx-auto max-w-3xl px-5 py-24 sm:px-6">
    <header>
      <p
        class="font-mono text-[11px] tracking-[0.24em] text-[#9a8464] uppercase"
      >
        Devices &amp; access
      </p>
      <h1 class="mt-4 text-3xl font-light tracking-[-0.02em] sm:text-4xl">
        Three passes, one route
      </h1>
      <p class="mt-4 max-w-lg text-sm leading-6 text-[#6d6152]">
        Each pass keeps exactly one identifier on its stub. Pull a pass out of
        the wallet to read what it proves.
      </p>
    </header>

    <div class="mt-14 flex flex-col">
      {#each order as stage, position (stage)}
        {@const Icon = stageIcons[stage]}
        {@const front = position === 0}
        {@const identifier = stageIdentifier(scenario, stage)}
        {@const seq = CHAIN_STAGES.indexOf(stage) + 1}
        <article class={`relative ${depthClass(position)}`}>
          <div
            class={`flex flex-col rounded-xl border bg-[#fbf6ec] sm:flex-row ${prepared ? 'border-[#d6c3a1]' : 'border-dashed border-[#c3ae89]'}`}
          >
            <div class="min-w-0 flex-1">
              <button
                type="button"
                class="block w-full px-6 py-5 text-left"
                aria-pressed={front}
                onclick={() => pull(stage)}
              >
                <span
                  class="flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] text-[#a48a66] uppercase"
                >
                  <Icon class="size-3.5" aria-hidden="true" />
                  {String(seq).padStart(2, '0')} · {relationInto(stage)}
                </span>
                <span class="mt-3 block text-xl font-light tracking-[-0.01em]">
                  {stageTitle(scenario, stage)}
                </span>
                <span class="mt-1 block text-xs text-[#8b7c68]">
                  {stageQuestion(stage)}
                </span>
              </button>

              {#if front}
                <div class="px-6 pb-6">
                  <p class="max-w-xl text-sm leading-6 text-[#6d6152]">
                    {stageMeaning(stage)}
                  </p>
                  <dl class="mt-5">
                    {#each stageEvidence(scenario, stage) as row (row.label)}
                      <div
                        class="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#e5d8c1] py-2.5"
                      >
                        <dt
                          class="font-mono text-[10px] tracking-[0.14em] text-[#a48a66] uppercase"
                        >
                          {row.label}
                        </dt>
                        <dd
                          class={`min-w-0 text-sm ${row.fact.kind === FactKind.Known ? 'font-mono break-all' : 'text-[#9a8a74] italic'}`}
                        >
                          {factText(row.fact)}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                </div>
              {/if}
            </div>

            <div
              class={`border-t border-dashed px-6 py-5 sm:w-48 sm:shrink-0 sm:border-t-0 sm:border-l ${prepared ? 'border-[#cbb492]' : 'border-[#c3ae89]'}`}
            >
              <p
                class="font-mono text-[9px] tracking-[0.22em] text-[#a48a66] uppercase"
              >
                {stageCaption(stage)} stub
              </p>
              {#if identifier.kind === FactKind.Known}
                <p
                  class="mt-2 rounded border border-[#b99a6f] bg-[#f2e5cd] px-2 py-1.5 font-mono text-[11px] tracking-[0.04em] break-all text-[#7c5a30]"
                >
                  {identifier.value}
                </p>
              {:else}
                <p
                  class="mt-2 rounded border border-dashed border-[#c3ae89] px-2 py-1.5 text-[11px] text-[#9a8a74] italic"
                >
                  {identifier.reason}
                </p>
              {/if}

              {#if front && stage === ChainStage.Vaults}
                <p
                  class="mt-5 font-mono text-[9px] tracking-[0.22em] text-[#a48a66] uppercase"
                >
                  Attached stubs
                </p>
                {#if scenario.vaults.length === 0}
                  <p
                    class="mt-2 rounded border border-dashed border-[#c3ae89] px-2 py-2 text-[11px] text-[#9a8a74] italic"
                  >
                    This device key has not opened a vault, so no stub was torn
                    off.
                  </p>
                {:else}
                  <ul class="mt-2 space-y-2">
                    {#each scenario.vaults as vault (vault.id)}
                      <li
                        class={`rounded border px-2 py-2 ${vault.trust === VaultTrust.Verified ? 'border-[#b99a6f] bg-[#f2e5cd]' : 'border-dashed border-[#c3ae89]'}`}
                      >
                        <p class="text-[11px] font-medium">{vault.label}</p>
                        <p
                          class={`mt-0.5 text-[10px] ${vault.trust === VaultTrust.Verified ? 'font-mono break-all text-[#7c5a30]' : 'text-[#9a8a74] italic'}`}
                        >
                          {factText(vault.verifiedAt)}
                        </p>
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          </div>

          <span
            class="absolute -top-2 right-[12rem] hidden size-4 translate-x-1/2 rounded-full bg-[#ece2d0] sm:block"
            aria-hidden="true"
          ></span>
          <span
            class="absolute -bottom-2 right-[12rem] hidden size-4 translate-x-1/2 rounded-full bg-[#ece2d0] sm:block"
            aria-hidden="true"
          ></span>
        </article>
      {/each}
    </div>

    {#if !prepared}
      <p
        class="mt-12 rounded-xl border border-dashed border-[#c3ae89] px-5 py-4 text-sm leading-6 text-[#6d6152]"
      >
        No pass has been issued for this browser yet. Preparing it creates the
        passkey, derives a device key that stays here, and only then can a vault
        stub be torn off.
      </p>
    {/if}
  </section>
</main>
