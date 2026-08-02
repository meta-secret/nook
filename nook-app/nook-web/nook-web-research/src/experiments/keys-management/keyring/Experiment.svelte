<!--
DIRECTION: A physical object per passkey. One hoop and one rail per passkey,
carrying exactly the vault tags that passkey opens. Every vault keeps the same
station across every rail, so a vault hanging on two rings is literally the same
column twice, and a vault on no ring at all is an empty column you can see.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    type Device,
    devicesForPasskey,
    devicesForVault,
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    highlightFor,
    isHere,
    type KeyGraph,
    NodeKind,
    type NodeRef,
    openableHere,
    opens,
    type Passkey,
    passkeysForVault,
    Reach,
    storeLabel,
    usableHere,
    type Vault,
    vaultsOpenableHere,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Station {
    key: string
    vault: Vault
    accent: string
    /** Whether a tag for this vault hangs on this ring at all. */
    hangs: boolean
    via: string[]
  }

  interface Ring {
    key: string
    passkey: Passkey
    devices: Device[]
    stations: Station[]
  }

  interface Column {
    key: string
    vault: Vault
    accent: string
    rings: number
  }

  const HEAD_REM = 13
  const STATION_REM = 9.5

  const ACCENTS = ['#a9743a', '#4f7a6a', '#8c5a6b', '#4a6a8c', '#7a6a3a']

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const columns = $derived(buildColumns(graph))
  const rings = $derived(buildRings(graph))
  const anchors = $derived(hereDevices(graph))
  const gridStyle = $derived(
    `grid-template-columns:${HEAD_REM}rem repeat(${graph.vaults.length},minmax(0,1fr))`,
  )
  const railStyle = $derived(
    `min-width:${HEAD_REM + graph.vaults.length * STATION_REM}rem`,
  )

  function accentOf(index: number): string {
    return ACCENTS[index % ACCENTS.length]
  }

  function buildColumns(graph: KeyGraph): Column[] {
    return graph.vaults.map((vault, index) => ({
      key: vault.id,
      vault,
      accent: accentOf(index),
      rings: passkeysForVault(graph, vault).length,
    }))
  }

  function buildRings(graph: KeyGraph): Ring[] {
    return graph.passkeys.map((passkey) => ({
      key: passkey.id,
      passkey,
      devices: devicesForPasskey(graph, passkey.id),
      stations: graph.vaults.map((vault, index) => ({
        key: `${passkey.id}-${vault.id}`,
        vault,
        accent: accentOf(index),
        hangs: opens(graph, passkey.id, vault),
        via: devicesForVault(graph, vault)
          .filter((device) => device.passkeyIds.includes(passkey.id))
          .map((device) => device.shortId),
      })),
    }))
  }

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function chosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function ringLit(ring: Ring): boolean {
    return highlight.passkeyIds.includes(ring.passkey.id)
  }

  function vaultLit(vault: Vault): boolean {
    return highlight.vaultIds.includes(vault.id)
  }

  function tagLit(ring: Ring, station: Station): boolean {
    return ringLit(ring) && vaultLit(station.vault)
  }

  function dim(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-30'
  }

  function plateClass(lit: boolean, picked: boolean): string {
    if (picked)
      return 'border-[#3b322a] bg-[#fdf8ec] shadow-[0_10px_20px_-16px_#4a4136]'
    return lit
      ? 'border-[#c8bca6] bg-[#f7f1e4]'
      : 'border-[#d5cbb8] bg-[#f2ebde]'
  }

  function chipClass(ok: boolean): string {
    return ok
      ? 'border-[#4f7a6a] text-[#3f6558]'
      : 'border-[#a24b3a] text-[#8f4232]'
  }
</script>

<main class="min-h-[100svh] bg-[#ece3d4] text-[#3b322a]">
  <ExperimentBack {navigate} light />
  <GraphSwitch
    {graph}
    light
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-6xl px-4 pt-28 pb-16 sm:px-8 sm:pt-24 sm:pb-20">
    <p class="font-mono text-[10px] tracking-[0.28em] text-[#8a7c68] uppercase">
      Nook · keyring
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      {#each anchors as anchor (anchor.id)}
        <span
          class="flex items-center gap-1.5 rounded-full border border-[#4f7a6a] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#3f6558] uppercase"
        >
          <KeyRound class="size-3" aria-hidden="true" />
          This browser {anchor.shortId}
        </span>
      {/each}
      {#if graph.here.kind === HereKind.Unprepared}
        <span
          class="rounded-full border border-[#a24b3a] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#8f4232] uppercase"
        >
          This browser · no device key
        </span>
      {/if}
      <span
        class="rounded-full border border-[#c8bca6] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#6f6355] uppercase"
      >
        Passkeys here {usableHere(graph).length}/{graph.passkeys.length}
      </span>
      <span
        class="rounded-full border border-[#c8bca6] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#6f6355] uppercase"
      >
        Vaults here {vaultsOpenableHere(graph).length}/{graph.vaults.length}
      </span>
    </div>

    <div class="mt-8 -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8">
      <div style={railStyle}>
        <div class="grid" style={gridStyle}>
          <div class="flex flex-col justify-end pr-3 pb-2">
            <p
              class="font-mono text-[9px] tracking-[0.2em] text-[#8a7c68] uppercase"
            >
              Rings ↓ · Vaults →
            </p>
          </div>

          {#each columns as column (column.key)}
            <div class="px-1.5">
              <button
                type="button"
                aria-pressed={chosen(NodeKind.Vault, column.vault.id)}
                class={`mx-auto block w-full max-w-[9rem] rounded-sm border px-2 py-2 text-left transition motion-reduce:transition-none ${plateClass(
                  vaultLit(column.vault),
                  chosen(NodeKind.Vault, column.vault.id),
                )}`}
                onclick={() => pick(NodeKind.Vault, column.vault.id)}
              >
                <span class={`block ${dim(vaultLit(column.vault))}`}>
                  <span
                    class="block h-1 w-full rounded-full"
                    style={`background:${column.accent}`}
                    aria-hidden="true"
                  ></span>
                  <span class="mt-2 flex items-center gap-1.5">
                    <VaultIcon class="size-3 shrink-0" aria-hidden="true" />
                    <span class="truncate text-[11px]"
                      >{column.vault.label}</span
                    >
                  </span>
                  <span class="mt-0.5 block font-mono text-[14px]">
                    {column.vault.shortId}
                  </span>
                  <span
                    class="mt-0.5 block font-mono text-[9px] tracking-[0.1em] text-[#8a7c68] uppercase"
                  >
                    {column.vault.secrets} secrets
                  </span>
                  <span class="mt-1.5 flex flex-wrap gap-1">
                    <span
                      class={`rounded-full border px-1.5 py-px font-mono text-[8px] tracking-[0.12em] uppercase ${chipClass(column.rings > 0)}`}
                    >
                      {column.rings > 0 ? `${column.rings} rings` : 'No ring'}
                    </span>
                    <span
                      class={`rounded-full border px-1.5 py-px font-mono text-[8px] tracking-[0.12em] uppercase ${chipClass(
                        openableHere(graph, column.vault),
                      )}`}
                    >
                      {openableHere(graph, column.vault)
                        ? 'Opens here'
                        : 'Not from here'}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          {/each}
        </div>

        {#each rings as ring (ring.key)}
          {@const away = ring.passkey.reach === Reach.Elsewhere}
          <div class="mt-14 grid" style={gridStyle}>
            <div class="relative flex flex-col">
              <span
                class={`h-[3px] w-full ${
                  away
                    ? 'bg-[#c3bcae]'
                    : 'bg-gradient-to-b from-[#e4ded2] via-[#a79d8d] to-[#7d7466]'
                }`}
                aria-hidden="true"
              ></span>
              <div class="flex items-start gap-2 pt-3 pr-3">
                <svg
                  viewBox="0 0 40 40"
                  class="-mt-9 size-11 shrink-0"
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
                    stroke-dasharray={away ? '54 34' : '74 14'}
                    transform="rotate(-55 20 20)"
                    class={away ? 'stroke-[#b7b0a2]' : 'stroke-[#9d9384]'}
                  />
                  <circle
                    cx="20"
                    cy="20"
                    r="14"
                    fill="none"
                    stroke-width="1"
                    stroke-dasharray={away ? '54 34' : '74 14'}
                    transform="rotate(-55 20 20)"
                    class={away ? 'stroke-[#e0dbd0]' : 'stroke-[#d8d1c4]'}
                  />
                </svg>

                <div class="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-pressed={chosen(NodeKind.Passkey, ring.passkey.id)}
                    class={`block w-full rounded-sm border px-2 py-2 text-left transition motion-reduce:transition-none ${plateClass(
                      ringLit(ring),
                      chosen(NodeKind.Passkey, ring.passkey.id),
                    )}`}
                    onclick={() => pick(NodeKind.Passkey, ring.passkey.id)}
                  >
                    <span class={`block ${dim(ringLit(ring))}`}>
                      <span
                        class="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.14em] text-[#8a7c68] uppercase"
                      >
                        <Fingerprint
                          class="size-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span class="truncate">
                          {storeLabel(ring.passkey.store)}
                        </span>
                      </span>
                      <span class="mt-1 block font-mono text-[15px]">
                        {ring.passkey.shortId}
                      </span>
                      <span class="block truncate text-[11px] text-[#6f6355]">
                        {ring.passkey.label}
                      </span>
                      <span
                        class={`mt-1.5 inline-block rounded-full border px-1.5 py-px font-mono text-[8px] tracking-[0.12em] uppercase ${chipClass(!away)}`}
                      >
                        {away ? 'Not on this computer' : 'On this computer'}
                      </span>
                    </span>
                  </button>

                  <div class="mt-1.5 flex flex-wrap gap-1">
                    {#each ring.devices as device (device.id)}
                      <button
                        type="button"
                        aria-pressed={chosen(NodeKind.Device, device.id)}
                        aria-label={`Device key ${device.shortId}, ${device.label}`}
                        class={`flex items-center gap-1 rounded-full border px-2 py-1 transition motion-reduce:transition-none ${
                          chosen(NodeKind.Device, device.id)
                            ? 'border-[#3b322a] bg-[#fdf8ec]'
                            : 'border-[#c8bca6] bg-[#f2ebde]'
                        } ${dim(highlight.deviceIds.includes(device.id))}`}
                        onclick={() => pick(NodeKind.Device, device.id)}
                      >
                        <KeyRound
                          class="size-2.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span class="font-mono text-[10px]">
                          {device.shortId}
                        </span>
                        {#if isHere(graph, device)}
                          <span
                            class="size-1.5 rounded-full bg-[#4f7a6a]"
                            aria-hidden="true"
                          ></span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            </div>

            {#each ring.stations as station (station.key)}
              <div class="relative flex flex-col">
                <span
                  class={`h-[3px] w-full ${
                    away
                      ? 'bg-[#c3bcae]'
                      : 'bg-gradient-to-b from-[#e4ded2] via-[#a79d8d] to-[#7d7466]'
                  }`}
                  aria-hidden="true"
                ></span>

                {#if station.hangs}
                  <div class="flex flex-col items-center px-1.5">
                    <span
                      class={`h-6 w-px ${away ? 'bg-[#c3bcae]' : 'bg-[#a79d8d]'} ${dim(tagLit(ring, station))}`}
                      aria-hidden="true"
                    ></span>
                    <button
                      type="button"
                      aria-pressed={chosen(NodeKind.Vault, station.vault.id)}
                      aria-label={`Vault ${station.vault.shortId}, ${station.vault.label}, on passkey ${ring.passkey.shortId}`}
                      class={`relative w-full max-w-[9rem] rounded-t-[1.2rem] rounded-b-sm border px-2 pt-6 pb-3 text-center transition motion-reduce:transition-none ${plateClass(
                        tagLit(ring, station),
                        chosen(NodeKind.Vault, station.vault.id),
                      )}`}
                      onclick={() => pick(NodeKind.Vault, station.vault.id)}
                    >
                      <span
                        class="absolute top-2 left-1/2 block size-2.5 -translate-x-1/2 rounded-full border border-[#b0a48e] bg-[#e0d8c7]"
                        aria-hidden="true"
                      ></span>
                      <span class={`block ${dim(tagLit(ring, station))}`}>
                        <span
                          class="mx-auto block h-1 w-8 rounded-full"
                          style={`background:${station.accent}`}
                          aria-hidden="true"
                        ></span>
                        <span
                          class="mt-1.5 block font-mono text-[15px] [text-shadow:0_1px_0_#fffdf6]"
                        >
                          {station.vault.shortId}
                        </span>
                        <span class="block truncate text-[11px] text-[#6f6355]">
                          {station.vault.label}
                        </span>
                        <span
                          class="mt-1 flex flex-wrap justify-center gap-1 font-mono text-[8px] tracking-[0.12em] text-[#8a7c68] uppercase"
                        >
                          <span>via</span>
                          {#each station.via as shortId (shortId)}
                            <span class="text-[#6f6355]">{shortId}</span>
                          {/each}
                        </span>
                      </span>
                    </button>
                  </div>
                {:else}
                  <div class="flex flex-col items-center px-1.5">
                    <span
                      class="h-6 w-px border-l border-dashed border-[#cfc6b4]"
                      aria-hidden="true"
                    ></span>
                    <span
                      class="w-full max-w-[9rem] rounded-t-[1.2rem] rounded-b-sm border border-dashed border-[#cfc6b4] py-5 text-center font-mono text-[12px] text-[#b3a893]"
                    >
                      <span aria-hidden="true">—</span>
                      <span class="sr-only">
                        {station.vault.shortId} does not hang on {ring.passkey
                          .shortId}
                      </span>
                    </span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </section>
</main>
