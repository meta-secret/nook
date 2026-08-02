<!--
DIRECTION: A physical object. One ring, one tag per thing that exists — the
passkey, the device key, and every vault the device key has met. Facts are
stamped into the tag face, so picking a tag is picking up the object.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Laptop, Vault } from '@lucide/svelte'
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
    stageTitle,
    vaultEvidence,
    VaultTrust,
    verifiedSummary,
    type EvidenceRow,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  type TagKind = 'passkey' | 'device' | 'vault'

  interface RingTag {
    key: string
    kind: TagKind
    caption: string
    title: string
    rows: EvidenceRow[]
    /** Whether this tag was actually cut, or is only a ghost of a future one. */
    cut: boolean
  }

  const PASSKEY_KEY = 'passkey'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let held = $state(PASSKEY_KEY)

  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const tags = $derived<RingTag[]>([
    {
      key: PASSKEY_KEY,
      kind: 'passkey',
      caption: stageCaption(ChainStage.Passkey),
      title: stageTitle(scenario, ChainStage.Passkey),
      rows: stageEvidence(scenario, ChainStage.Passkey),
      cut: prepared,
    },
    {
      key: 'device-key',
      kind: 'device',
      caption: stageCaption(ChainStage.DeviceKey),
      title: 'This browser',
      rows: stageEvidence(scenario, ChainStage.DeviceKey),
      cut: prepared,
    },
    ...scenario.vaults.map((vault) => ({
      key: vault.id,
      kind: 'vault' as TagKind,
      caption:
        vault.trust === VaultTrust.Verified
          ? 'Vault · opened'
          : 'Vault · never opened',
      title: vault.label,
      rows: vaultEvidence(vault),
      cut: vault.trust === VaultTrust.Verified,
    })),
  ])

  /** Tags hang at different lengths and angles, the way they would on a ring. */
  const HANG = [
    { cord: 'h-10', tilt: 'rotate-[-5deg]' },
    { cord: 'h-6', tilt: 'rotate-[3deg]' },
    { cord: 'h-12', tilt: 'rotate-[-2deg]' },
    { cord: 'h-8', tilt: 'rotate-[6deg]' },
    { cord: 'h-14', tilt: 'rotate-[-4deg]' },
  ]

  function hang(index: number): { cord: string; tilt: string } {
    return HANG[index % HANG.length]
  }

  const TAG_BASE =
    'relative w-full origin-top rounded-t-[1.35rem] rounded-b-sm border px-3 pt-6 pb-4 text-left transition duration-300 motion-reduce:transition-none'

  function tagClass(holding: boolean, cut: boolean, tilt: string): string {
    if (holding) {
      const lifted = `${TAG_BASE} z-10 -translate-y-1 rotate-0 border-[#a9743a] shadow-[0_18px_28px_-18px_#4a4136]`
      return cut
        ? `${lifted} bg-[#fdf8ec]`
        : `${lifted} border-dashed bg-[#f4ecdd]`
    }
    const resting = `${TAG_BASE} ${tilt} shadow-[0_8px_16px_-14px_#4a4136] hover:border-[#a9743a]`
    return cut
      ? `${resting} border-[#c8bca6] bg-[#f7f1e4]`
      : `${resting} border-dashed border-[#c2b6a1] bg-[#efe8da]`
  }
</script>

<main class="min-h-[100svh] bg-[#ece3d4] text-[#3b322a]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      held = PASSKEY_KEY
    }}
  />

  <section class="mx-auto max-w-5xl px-5 py-20 sm:px-8">
    <p class="font-mono text-[10px] tracking-[0.28em] text-[#8a7c68] uppercase">
      Devices &amp; access · the ring
    </p>
    <h1 class="mt-3 text-2xl font-light tracking-[-0.01em] sm:text-3xl">
      Pick up a tag to read what is stamped on it
    </h1>
    <p class="mt-3 max-w-xl text-sm leading-6 text-[#6f6355]">
      The passkey stays in your passkey manager — its tag carries only the
      fingerprint Nook keeps. The device key tag exists only in this browser.
    </p>

    <!-- The ring is one bar: tags stay on it and the strip scrolls sideways
    rather than wrapping a tag onto a row with nothing to hang from. -->
    <div class="mt-12 -mx-5 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
      <div class="w-max min-w-full">
        <div class="flex items-center gap-1">
          <svg
            viewBox="0 0 40 40"
            class="size-14 shrink-0"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              cx="20"
              cy="20"
              r="14"
              fill="none"
              stroke-width="3.2"
              stroke-linecap="round"
              stroke-dasharray="74 14"
              transform="rotate(-55 20 20)"
              class="stroke-[#9d9384]"
            />
            <circle
              cx="20"
              cy="20"
              r="14"
              fill="none"
              stroke-width="1"
              stroke-dasharray="74 14"
              transform="rotate(-55 20 20)"
              class="stroke-[#d8d1c4]"
            />
          </svg>
          <span
            class="h-[3px] flex-1 rounded-full bg-gradient-to-b from-[#e4ded2] via-[#a79d8d] to-[#7d7466]"
          ></span>
          <span
            class="ml-3 font-mono text-[10px] tracking-[0.2em] text-[#8a7c68] uppercase"
          >
            {verifiedSummary(scenario)}
          </span>
        </div>

        <div class="flex flex-nowrap items-start gap-4 pl-4">
          {#each tags as tag, index (tag.key)}
            {@const shape = hang(index)}
            {@const holding = held === tag.key}
            <div class="flex w-[9.5rem] flex-col items-center">
              <span
                class={`${shape.cord} ${tag.cut ? 'w-px bg-[#a79d8d]' : 'w-0 border-l border-dashed border-[#bcb2a0]'}`}
                aria-hidden="true"
              ></span>
              <button
                type="button"
                aria-pressed={holding}
                class={tagClass(holding, tag.cut, shape.tilt)}
                onclick={() => (held = tag.key)}
              >
                <span
                  class="absolute top-2.5 left-1/2 block size-2.5 -translate-x-1/2 rounded-full border border-[#b0a48e] bg-[#e0d8c7]"
                  aria-hidden="true"
                ></span>

                <span
                  class="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] text-[#8a7c68] uppercase"
                >
                  {#if tag.kind === 'passkey'}
                    <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
                  {:else if tag.kind === 'device'}
                    <Laptop class="size-3 shrink-0" aria-hidden="true" />
                  {:else}
                    <Vault class="size-3 shrink-0" aria-hidden="true" />
                  {/if}
                  <span class="truncate">{tag.caption}</span>
                </span>

                <span
                  class="mt-1.5 block text-sm leading-tight break-words text-[#3b322a] [text-shadow:0_1px_0_#fffdf6]"
                >
                  {tag.title}
                </span>

                {#if holding}
                  <dl class="mt-3 border-t border-[#d8cdb8] pt-2">
                    {#each tag.rows as row (row.label)}
                      <div class="py-1">
                        <dt
                          class="font-mono text-[8px] tracking-[0.14em] text-[#9c8f7a] uppercase"
                        >
                          {row.label}
                        </dt>
                        <dd
                          class={`text-[10px] leading-4 ${row.fact.kind === FactKind.Known ? 'font-mono break-all text-[#4a4136] [text-shadow:0_1px_0_#fffdf6]' : 'text-[#9c8f7a] italic'}`}
                        >
                          {factText(row.fact)}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                {:else}
                  <span
                    class="mt-3 block font-mono text-[9px] tracking-[0.14em] text-[#a2957f] uppercase"
                  >
                    {tag.cut ? 'Read tag' : 'Blank'}
                  </span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      </div>
    </div>

    {#if !prepared}
      <div
        class="mt-12 max-w-xl rounded-md border border-dashed border-[#c2b6a1] p-5"
      >
        <p
          class="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-[#8a7c68] uppercase"
        >
          <KeyRound class="size-3.5" aria-hidden="true" />
          Empty ring
        </p>
        <p class="mt-3 text-sm leading-6 text-[#6f6355]">
          Nothing has been stamped for this browser yet. Preparing it cuts the
          first two tags — a passkey you keep in your own manager, and a device
          key that never leaves here. Vault tags appear one at a time, as this
          device key actually opens each vault.
        </p>
        <button
          type="button"
          class="mt-5 rounded-full bg-[#3b322a] px-6 py-3 text-sm font-medium text-[#f7f1e4] transition hover:bg-[#54473b] motion-reduce:transition-none"
        >
          Prepare this browser
        </button>
      </div>
    {:else}
      <p class="mt-12 max-w-xl text-sm leading-6 text-[#6f6355]">
        {scenario.device.boundary} A vault only earns a tag once this device key has
        opened it.
      </p>
    {/if}
  </section>
</main>
