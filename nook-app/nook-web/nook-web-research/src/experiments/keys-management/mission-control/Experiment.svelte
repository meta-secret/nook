<!--
DIRECTION: A dark operator console. Everything is on screen at once — status
strip, the three links as a selectable stack, the selected link's readout, and
the vault ledger — because an operator scans rather than navigates.
-->
<script lang="ts">
  import { Fingerprint, Laptop, ShieldCheck, Vault } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    CHAIN_STAGES,
    ChainStage,
    FactKind,
    factText,
    IdentityState,
    isPrepared,
    relationInto,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageEvidence,
    stageIdentifier,
    stageMeaning,
    stageTitle,
    VaultTrust,
    verifiedSummary,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let selected = $state(ChainStage.Passkey)
  const scenario = $derived(scenarioById(scenarioId))
  const evidence = $derived(stageEvidence(scenario, selected))
  const identifier = $derived(stageIdentifier(scenario, selected))

  const stageIcons = {
    [ChainStage.Passkey]: Fingerprint,
    [ChainStage.DeviceKey]: Laptop,
    [ChainStage.Vaults]: Vault,
  }
</script>

<main class="min-h-[100svh] bg-[#0a0a0b] text-[#e6e6e3]">
  <ExperimentBack {navigate} />
  <ScenarioSwitch {scenario} onScenario={(next) => (scenarioId = next)} />

  <section class="mx-auto max-w-6xl px-6 py-20">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <p
          class="font-mono text-[11px] tracking-[0.28em] text-[#6f6f6a] uppercase"
        >
          Devices &amp; access
        </p>
        <h1 class="mt-3 text-3xl font-light tracking-[-0.03em]">
          Access chain, this browser
        </h1>
      </div>
      <div class="flex items-center gap-2 font-mono text-[11px]">
        <span
          class={`size-2 rounded-full ${scenario.identity === IdentityState.Unlocked ? 'bg-[#a6e22e]' : 'bg-[#8a8a85]'}`}
        ></span>
        <span class="tracking-[0.18em] uppercase">{scenario.identityLabel}</span
        >
      </div>
    </header>

    <div
      class="mt-10 grid gap-px overflow-hidden rounded-lg border border-[#232326] bg-[#232326] sm:grid-cols-3"
    >
      <div class="bg-[#0f0f11] px-5 py-4">
        <p
          class="font-mono text-[10px] tracking-[0.2em] text-[#6f6f6a] uppercase"
        >
          Protection
        </p>
        <p class="mt-2 text-sm">{scenario.protectionLabel}</p>
      </div>
      <div class="bg-[#0f0f11] px-5 py-4">
        <p
          class="font-mono text-[10px] tracking-[0.2em] text-[#6f6f6a] uppercase"
        >
          Device key
        </p>
        <p class="mt-2 font-mono text-sm break-all">
          {factText(scenario.device.id)}
        </p>
      </div>
      <div class="bg-[#0f0f11] px-5 py-4">
        <p
          class="font-mono text-[10px] tracking-[0.2em] text-[#6f6f6a] uppercase"
        >
          Verified vaults
        </p>
        <p class="mt-2 text-sm">{verifiedSummary(scenario)}</p>
      </div>
    </div>

    <div class="mt-8 grid gap-8 lg:grid-cols-[22rem_1fr]">
      <div role="tablist" aria-label="Access chain" class="space-y-1">
        {#each CHAIN_STAGES as stage, index (stage)}
          {@const Icon = stageIcons[stage]}
          {@const active = stage === selected}
          {#if index > 0}
            <p
              class="pl-6 font-mono text-[10px] tracking-[0.24em] text-[#5c5c58] uppercase"
            >
              │ {relationInto(stage)}
            </p>
          {/if}
          <button
            type="button"
            role="tab"
            aria-selected={active}
            class={`flex w-full items-start gap-3 rounded-md border px-4 py-3 text-left transition ${
              active
                ? 'border-[#a6e22e]/50 bg-[#16180f]'
                : 'border-[#232326] bg-[#0f0f11] hover:border-[#3a3a3e]'
            }`}
            onclick={() => (selected = stage)}
          >
            <Icon
              class={`mt-0.5 size-4 ${active ? 'text-[#a6e22e]' : 'text-[#6f6f6a]'}`}
              aria-hidden="true"
            />
            <span class="min-w-0">
              <span
                class="block font-mono text-[10px] tracking-[0.2em] text-[#6f6f6a] uppercase"
              >
                {stageCaption(stage)}
              </span>
              <span class="mt-1 block truncate text-sm"
                >{stageTitle(scenario, stage)}</span
              >
            </span>
          </button>
        {/each}
      </div>

      <div class="rounded-lg border border-[#232326] bg-[#0f0f11] p-6">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="text-lg font-light">{stageCaption(selected)}</h2>
          {#if identifier.kind === FactKind.Known}
            <p class="font-mono text-xs break-all text-[#8a8a85]">
              {identifier.value}
            </p>
          {/if}
        </div>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-[#9a9a95]">
          {stageMeaning(selected)}
        </p>
        <dl
          class="mt-6 space-y-px overflow-hidden rounded border border-[#232326]"
        >
          {#each evidence as row (row.label)}
            <div
              class="flex flex-wrap items-baseline justify-between gap-4 bg-[#141416] px-4 py-2.5"
            >
              <dt
                class="font-mono text-[11px] tracking-[0.12em] text-[#6f6f6a] uppercase"
              >
                {row.label}
              </dt>
              <dd
                class={`text-sm ${row.fact.kind === FactKind.Known ? 'font-mono break-all' : 'text-[#6f6f6a] italic'}`}
              >
                {factText(row.fact)}
              </dd>
            </div>
          {/each}
        </dl>
      </div>
    </div>

    {#if scenario.vaults.length > 0}
      <table class="mt-8 w-full border-collapse text-left text-sm">
        <thead>
          <tr
            class="font-mono text-[10px] tracking-[0.2em] text-[#6f6f6a] uppercase"
          >
            <th class="border-b border-[#232326] py-2 font-normal">Vault</th>
            <th class="border-b border-[#232326] py-2 font-normal">Access</th>
            <th class="border-b border-[#232326] py-2 font-normal">Devices</th>
            <th class="border-b border-[#232326] py-2 font-normal">Backups</th>
          </tr>
        </thead>
        <tbody>
          {#each scenario.vaults as vault (vault.id)}
            <tr>
              <td class="border-b border-[#1a1a1d] py-3">{vault.label}</td>
              <td class="border-b border-[#1a1a1d] py-3">
                <span class="flex items-center gap-2">
                  {#if vault.trust === VaultTrust.Verified}
                    <ShieldCheck
                      class="size-3.5 text-[#a6e22e]"
                      aria-hidden="true"
                    />
                    <span class="font-mono text-xs"
                      >{factText(vault.verifiedAt)}</span
                    >
                  {:else}
                    <span class="font-mono text-xs text-[#6f6f6a]"
                      >{factText(vault.verifiedAt)}</span
                    >
                  {/if}
                </span>
              </td>
              <td class="border-b border-[#1a1a1d] py-3 font-mono text-xs"
                >{vault.enrolledDevices}</td
              >
              <td class="border-b border-[#1a1a1d] py-3 font-mono text-xs"
                >{vault.backupPasswords}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if !isPrepared(scenario)}
      <p
        class="mt-8 rounded-lg border border-dashed border-[#33333a] px-5 py-4 text-sm text-[#8a8a85]"
      >
        No links exist yet. Preparing this browser creates the passkey, derives
        the device key, and only then can a vault be verified from here.
      </p>
    {/if}
  </section>
</main>
