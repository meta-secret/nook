<!--
DIRECTION: A radial map. The device key sits at the center because it is the
only one of the three things that actually exists in this browser; the passkey
rides an outer arc and points inward; vaults orbit as satellites.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    ChainStage,
    FactKind,
    factText,
    isPrepared,
    known,
    relationInto,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageEvidence,
    stageIdentifier,
    stageMeaning,
    stageTitle,
    vaultEvidence,
    VaultTrust,
    verifiedSummary,
    type VaultLink,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  type Focus =
    | { at: ChainStage.Passkey }
    | { at: ChainStage.DeviceKey }
    | { at: ChainStage.Vaults; vault: VaultLink }

  interface Point {
    x: number
    y: number
  }

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let focus = $state<Focus>({ at: ChainStage.DeviceKey })

  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const rows = $derived(
    focus.at === ChainStage.Vaults
      ? vaultEvidence(focus.vault)
      : stageEvidence(scenario, focus.at),
  )
  const title = $derived(
    focus.at === ChainStage.Vaults
      ? focus.vault.label
      : stageTitle(scenario, focus.at),
  )
  const identifier = $derived(
    focus.at === ChainStage.Vaults
      ? known(focus.vault.id)
      : stageIdentifier(scenario, focus.at),
  )

  const PASSKEY_POINT: Point = { x: 50, y: 12 }
  const ORBIT_RADIUS = 34

  function orbitPoint(angle: number, radius: number): Point {
    const radians = (angle * Math.PI) / 180
    return {
      x: 50 + Math.cos(radians) * radius,
      y: 50 + Math.sin(radians) * radius,
    }
  }

  /** Satellites keep to the lower hemisphere so the passkey arc stays clear. */
  function satelliteAngle(index: number, count: number): number {
    if (count < 2) return 55
    return 18 + (144 / (count - 1)) * index
  }

  const satellites = $derived(
    scenario.vaults.map((vault, index) => ({
      vault,
      point: orbitPoint(
        satelliteAngle(index, scenario.vaults.length),
        ORBIT_RADIUS,
      ),
    })),
  )

  const outerArc = (() => {
    const start = orbitPoint(-146, 38)
    const end = orbitPoint(-34, 38)
    return `M ${start.x} ${start.y} A 38 38 0 0 1 ${end.x} ${end.y}`
  })()

  function place(point: Point): string {
    return `left: ${point.x}%; top: ${point.y}%`
  }

  function isSatelliteFocused(vault: VaultLink): boolean {
    return focus.at === ChainStage.Vaults && focus.vault.id === vault.id
  }

  function bodyClass(active: boolean, solid: boolean): string {
    if (active) return 'border-[#f0b429] bg-[#1a1408] text-[#f6d798]'
    return solid
      ? 'border-[#26263c] bg-[#0b0b18] text-[#b9b9d4] hover:border-[#4a4a6b]'
      : 'border-dashed border-[#26263c] bg-transparent text-[#6a6a86] hover:border-[#4a4a6b]'
  }
</script>

<main class="min-h-[100svh] bg-[#050510] text-[#d8d8ea]">
  <ExperimentBack {navigate} />
  <ScenarioSwitch
    {scenario}
    onScenario={(next) => {
      scenarioId = next
      focus = { at: ChainStage.DeviceKey }
    }}
  />

  <section class="mx-auto max-w-5xl px-5 py-20 sm:px-8">
    <p class="font-mono text-[10px] tracking-[0.32em] text-[#6a6a86] uppercase">
      Devices &amp; access · orbit map
    </p>
    <h1 class="mt-3 max-w-lg text-2xl leading-snug font-light sm:text-3xl">
      This browser's key is the center of everything it can reach
    </h1>

    <div class="mt-10 grid items-start gap-10 lg:grid-cols-[1fr_19rem]">
      <div class="relative mx-auto aspect-square w-full max-w-[26rem]">
        <svg
          viewBox="0 0 100 100"
          class="absolute inset-0 h-full w-full"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={outerArc}
            fill="none"
            stroke-width="0.4"
            class="stroke-[#26263c] [stroke-dasharray:1.5_2]"
          />
          <circle
            cx="50"
            cy="50"
            r={ORBIT_RADIUS}
            fill="none"
            stroke-width="0.4"
            class={satellites.length > 0
              ? 'stroke-[#26263c]'
              : 'stroke-[#1c1c2e] [stroke-dasharray:1.5_2]'}
          />
          <line
            x1="50"
            y1="19"
            x2="50"
            y2="28"
            stroke-width="0.5"
            class={prepared
              ? 'stroke-[#f0b429]/70'
              : 'stroke-[#26263c] [stroke-dasharray:1.5_2]'}
          />
          <path
            d="M 48.6 27.5 L 50 31 L 51.4 27.5 Z"
            class={prepared ? 'fill-[#f0b429]/70' : 'fill-[#26263c]'}
          />
          {#each satellites as body (body.vault.id)}
            <line
              x1="50"
              y1="50"
              x2={body.point.x}
              y2={body.point.y}
              stroke-width="0.4"
              class={body.vault.trust === VaultTrust.Verified
                ? 'stroke-[#f0b429]/45'
                : 'stroke-[#33334d] [stroke-dasharray:1.2_1.8]'}
            />
          {/each}
        </svg>

        <button
          type="button"
          aria-pressed={focus.at === ChainStage.Passkey}
          class={`absolute w-[9rem] -translate-x-1/2 -translate-y-1/2 rounded-full border px-3 py-2 text-center transition ${bodyClass(focus.at === ChainStage.Passkey, prepared)}`}
          style={place(PASSKEY_POINT)}
          onclick={() => (focus = { at: ChainStage.Passkey })}
        >
          <span
            class="flex items-center justify-center gap-1.5 font-mono text-[9px] tracking-[0.18em] uppercase"
          >
            <Fingerprint class="size-3" aria-hidden="true" />
            {stageCaption(ChainStage.Passkey)}
          </span>
          <span class="mt-0.5 block truncate text-xs">
            {stageTitle(scenario, ChainStage.Passkey)}
          </span>
        </button>

        <span
          class="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#050510] px-1 font-mono text-[9px] tracking-[0.2em] text-[#6a6a86] uppercase"
          style="top: 26%"
        >
          {relationInto(ChainStage.DeviceKey)} ↓
        </span>

        <button
          type="button"
          aria-pressed={focus.at === ChainStage.DeviceKey}
          class={`absolute top-1/2 left-1/2 flex size-[7.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-center transition ${bodyClass(focus.at === ChainStage.DeviceKey, prepared)}`}
          onclick={() => (focus = { at: ChainStage.DeviceKey })}
        >
          <Laptop class="size-4" aria-hidden="true" />
          <span class="mt-1.5 font-mono text-[9px] tracking-[0.18em] uppercase">
            {stageCaption(ChainStage.DeviceKey)}
          </span>
          <span class="mt-0.5 px-3 text-xs">This browser</span>
          <span
            class="mt-1 max-w-[6rem] truncate font-mono text-[9px] text-[#6a6a86]"
          >
            {factText(scenario.device.id)}
          </span>
        </button>

        {#if satellites.length > 0}
          <span
            class="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#050510] px-1 font-mono text-[9px] tracking-[0.2em] text-[#6a6a86] uppercase"
            style="top: 72%"
          >
            {relationInto(ChainStage.Vaults)}
          </span>
        {/if}

        {#each satellites as body (body.vault.id)}
          <button
            type="button"
            aria-pressed={isSatelliteFocused(body.vault)}
            class={`absolute max-w-[7rem] -translate-x-1/2 -translate-y-1/2 rounded-md border px-2.5 py-1.5 text-center transition ${bodyClass(
              isSatelliteFocused(body.vault),
              body.vault.trust === VaultTrust.Verified,
            )}`}
            style={place(body.point)}
            onclick={() =>
              (focus = { at: ChainStage.Vaults, vault: body.vault })}
          >
            <span class="flex items-center justify-center gap-1">
              <Vault class="size-3" aria-hidden="true" />
              <span class="truncate text-xs">{body.vault.label}</span>
            </span>
          </button>
        {/each}

        {#if satellites.length === 0}
          <p
            class="absolute inset-x-6 bottom-2 text-center font-mono text-[10px] leading-4 tracking-[0.14em] text-[#54546e] uppercase"
          >
            Nothing orbits this browser yet
          </p>
        {/if}
      </div>

      <aside
        class="min-w-0 rounded-lg border border-[#1c1c2e] bg-[#080814] p-5"
      >
        <p
          class="font-mono text-[10px] tracking-[0.24em] text-[#f0b429] uppercase"
        >
          {stageCaption(focus.at)}
        </p>
        <h2 class="mt-2 text-lg font-light break-words">{title}</h2>
        {#if identifier.kind === FactKind.Known}
          <p class="mt-1 font-mono text-[11px] break-all text-[#7a7a99]">
            {identifier.value}
          </p>
        {:else}
          <p class="mt-1 text-[11px] text-[#54546e] italic">
            {identifier.reason}
          </p>
        {/if}

        <p class="mt-4 text-sm leading-6 text-[#9a9ab8]">
          {stageMeaning(focus.at)}
        </p>

        <dl class="mt-5 border-t border-[#1c1c2e]">
          {#each rows as row (row.label)}
            <div
              class="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#1c1c2e] py-2.5"
            >
              <dt
                class="font-mono text-[10px] tracking-[0.14em] text-[#6a6a86] uppercase"
              >
                {row.label}
              </dt>
              <dd
                class={`min-w-0 text-xs ${row.fact.kind === FactKind.Known ? 'font-mono break-all text-[#d8d8ea]' : 'text-[#54546e] italic'}`}
              >
                {factText(row.fact)}
              </dd>
            </div>
          {/each}
        </dl>

        <p
          class="mt-5 font-mono text-[10px] leading-5 tracking-[0.14em] text-[#54546e] uppercase"
        >
          {verifiedSummary(scenario)}
        </p>
      </aside>
    </div>
  </section>
</main>
