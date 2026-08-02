<!--
DIRECTION: A machined cabinet. Each link is a horizontal drawer whose face
carries only its label and the one identifier it owns; opening a drawer slides
it out of the frame and compresses the rest. The vault drawer holds folders.
-->
<script lang="ts">
  import {
    Fingerprint,
    Folder,
    Laptop,
    ShieldCheck,
    Vault,
  } from '@lucide/svelte'
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
    stageMeaning,
    stageTitle,
    vaultEvidence,
    VaultTrust,
    verifiedSummary,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let openStage = $state(ChainStage.Passkey)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))

  const drawerIcons = {
    [ChainStage.Passkey]: Fingerprint,
    [ChainStage.DeviceKey]: Laptop,
    [ChainStage.Vaults]: Vault,
  }

  function panelId(stage: ChainStage): string {
    return `evidence-drawer-${stage}`
  }

  function drawerRows(stage: ChainStage): EvidenceRow[] {
    if (stage === ChainStage.Passkey) {
      return [...passkeyEvidence(scenario), ...passkeyRawEvidence(scenario)]
    }
    return [
      ...deviceKeyEvidence(scenario),
      { label: 'Boundary', fact: known(scenario.device.boundary) },
    ]
  }
</script>

<main
  class="min-h-[100svh] bg-[linear-gradient(180deg,#101215_0%,#16191d_60%,#101215_100%)] text-[#dfe3e7]"
>
  <ExperimentBack {navigate} />
  <ScenarioSwitch {scenario} onScenario={(next) => (scenarioId = next)} />

  <section class="mx-auto max-w-3xl px-5 py-20 sm:px-6">
    <header class="max-w-xl">
      <p
        class="font-mono text-[11px] tracking-[0.26em] text-[#7c858f] uppercase"
      >
        Devices &amp; access
      </p>
      <h1 class="mt-4 text-3xl font-light tracking-[-0.02em] sm:text-4xl">
        Evidence cabinet
      </h1>
      <p class="mt-4 text-sm leading-6 text-[#9aa4ae]">
        Three drawers, one open at a time. A closed drawer shows only its label
        and the single identifier engraved on its face.
      </p>
    </header>

    <div
      class="mt-12 rounded-lg border border-[#2b3037] bg-[#181b1f] p-3 shadow-[0_30px_70px_rgb(0_0_0/0.55)] sm:pr-11"
    >
      {#each CHAIN_STAGES as stage, index (stage)}
        {@const Icon = drawerIcons[stage]}
        {@const open = openStage === stage}
        {@const identifier = stageIdentifier(scenario, stage)}
        <div
          class={`relative transition-transform duration-500 ease-out motion-reduce:transition-none motion-reduce:translate-x-0 ${index > 0 ? 'mt-2' : ''} ${open ? 'sm:translate-x-8' : ''}`}
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId(stage)}
            onclick={() => (openStage = stage)}
            class={`block w-full rounded-t border border-[#3b424a] bg-[linear-gradient(180deg,#333a41_0%,#272c32_55%,#1e2227_100%)] px-4 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.09)] transition-all duration-500 ease-out motion-reduce:transition-none ${open ? 'py-4' : 'rounded-b py-2.5'}`}
          >
            <span class="flex items-center gap-3">
              <span class="flex items-center gap-1" aria-hidden="true">
                <span class="size-1.5 rounded-full bg-[#4c545d]"></span>
                <span class="size-1.5 rounded-full bg-[#4c545d]"></span>
              </span>
              <span class="min-w-0 flex-1">
                <span
                  class="flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] text-[#8b949e] uppercase"
                >
                  <Icon class="size-3.5" aria-hidden="true" />
                  {stageCaption(stage)}
                </span>
                <span class="mt-1 block text-sm break-words">
                  {stageTitle(scenario, stage)}
                </span>
              </span>
              <span
                class="hidden min-w-0 shrink-0 basis-56 text-right sm:block"
              >
                {#if identifier.kind === FactKind.Known}
                  <span class="font-mono text-[11px] break-all text-[#b9c2cb]">
                    {identifier.value}
                  </span>
                {:else}
                  <span class="text-[11px] text-[#79828c] italic">
                    {identifier.reason}
                  </span>
                {/if}
              </span>
              <span
                class="ml-1 h-6 w-8 shrink-0 rounded-sm bg-[repeating-linear-gradient(90deg,#535b64_0_1px,#2c3238_1px_3px)] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
                aria-hidden="true"
              ></span>
            </span>
            <span
              class={`mt-2 block text-[10px] sm:hidden ${identifier.kind === FactKind.Known ? 'font-mono break-all text-[#b9c2cb]' : 'break-words text-[#79828c] italic'}`}
            >
              {factText(identifier)}
            </span>
          </button>

          <div
            id={panelId(stage)}
            class={`rounded-b border border-t-0 border-[#2b3037] bg-[#13161a] px-4 ${open ? 'block py-4' : 'hidden'}`}
          >
            <p class="max-w-xl text-[13px] leading-6 text-[#9aa4ae]">
              {stageMeaning(stage)}
            </p>

            {#if stage === ChainStage.Vaults}
              <p
                class="mt-4 font-mono text-[10px] tracking-[0.2em] text-[#79828c] uppercase"
              >
                Folders · {verifiedSummary(scenario)}
              </p>
              {#if scenario.vaults.length === 0}
                <p
                  class="mt-2 rounded border border-dashed border-[#3b424a] px-3 py-3 text-[13px] text-[#79828c] italic"
                >
                  The drawer is empty. A folder appears only after this device
                  key has actually opened a vault.
                </p>
              {:else}
                <ul class="mt-2 space-y-2">
                  {#each scenario.vaults as vault (vault.id)}
                    <li
                      class={`rounded border px-3 py-2.5 ${vault.trust === VaultTrust.Verified ? 'border-[#3b424a] bg-[#1a1f24]' : 'border-dashed border-[#3b424a]'}`}
                    >
                      <p class="flex items-center gap-2 text-sm">
                        <Folder
                          class="size-3.5 shrink-0 text-[#8b949e]"
                          aria-hidden="true"
                        />
                        <span class="min-w-0 break-words">{vault.label}</span>
                        {#if vault.trust === VaultTrust.Verified}
                          <ShieldCheck
                            class="ml-auto size-3.5 shrink-0 text-[#7fb0d8]"
                            aria-hidden="true"
                          />
                        {/if}
                      </p>
                      <dl class="mt-2 grid gap-x-6 sm:grid-cols-2">
                        {#each vaultEvidence(vault) as row (row.label)}
                          <div
                            class="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#22272c] py-1.5"
                          >
                            <dt
                              class="font-mono text-[9px] tracking-[0.16em] text-[#79828c] uppercase"
                            >
                              {row.label}
                            </dt>
                            <dd
                              class={`text-[12px] ${row.fact.kind === FactKind.Known ? 'font-mono break-all' : 'text-[#79828c] italic'}`}
                            >
                              {factText(row.fact)}
                            </dd>
                          </div>
                        {/each}
                      </dl>
                    </li>
                  {/each}
                </ul>
              {/if}
            {:else}
              <dl class="mt-4 grid gap-x-8 sm:grid-cols-2">
                {#each drawerRows(stage) as row (row.label)}
                  <div
                    class="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#22272c] py-2"
                  >
                    <dt
                      class="font-mono text-[9px] tracking-[0.18em] text-[#79828c] uppercase"
                    >
                      {row.label}
                    </dt>
                    <dd
                      class={`text-[13px] ${row.fact.kind === FactKind.Known ? 'font-mono break-words' : 'break-words text-[#79828c] italic'}`}
                    >
                      {factText(row.fact)}
                    </dd>
                  </div>
                {/each}
              </dl>
            {/if}

            <p
              class="mt-4 font-mono text-[10px] tracking-[0.18em] text-[#5f686f] uppercase"
            >
              {stage === ChainStage.Passkey
                ? 'This drawer is the start of the chain'
                : `Reached because the drawer above ${relationInto(stage)} it`}
            </p>
          </div>
        </div>
      {/each}
    </div>

    {#if !prepared}
      <p
        class="mt-8 rounded border border-dashed border-[#3b424a] px-5 py-4 text-sm leading-6 text-[#9aa4ae]"
      >
        Nothing has been filed in this cabinet yet. Preparing this browser
        engraves the passkey fingerprint on the first face, derives the device
        key for the second, and leaves the third empty until a vault is opened
        from here.
      </p>
    {/if}
  </section>
</main>
