<!--
DIRECTION: A drafted sheet. Every passkey, device key and vault is a numbered
part whose part number is its identifier; the wiring between them is drawn as
routed relations across three stations; the margin carries a parts schedule and
the corner a title block. Selecting a part lights its relations, dims the sheet.
-->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    devicesForPasskey,
    devicesForVault,
    edgeLit,
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    type Highlight,
    highlightFor,
    isHere,
    type KeyGraph,
    kindLabel,
    NodeKind,
    type NodeRef,
    openableHere,
    passkeysForDevice,
    Reach,
    storeLabel,
    usableHere,
    vaultsForDevice,
    vaultsOpenableHere,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Part {
    key: string
    kind: NodeKind
    id: string
    shortId: string
    label: string
    where: string
    state: string
    /** Whether the part is usable from the browser drawn on this sheet. */
    here: boolean
    wires: string[]
    x: number
    y: number
  }

  interface Run {
    id: string
    points: string
    lit: boolean
  }

  const PASSKEY_X = 20
  const DEVICE_X = 50
  const VAULT_X = 80

  /** Routing bands sit in the gaps between part columns at every sheet width. */
  const UNLOCK_BAND = { start: 31.4, end: 38.6 }
  const OPEN_BAND = { start: 61.4, end: 68.6 }

  const RULE_TICKS = [8, 20, 32, 44, 56, 68, 80, 92]

  const GRID =
    '[background-image:linear-gradient(to_right,#0d2c46_1px,transparent_1px),linear-gradient(to_bottom,#0d2c46_1px,transparent_1px)] [background-size:26px_26px]'

  const STATIONS = [
    { code: 'A', title: 'Passkeys', kind: NodeKind.Passkey, x: PASSKEY_X },
    { code: 'B', title: 'Device keys', kind: NodeKind.Device, x: DEVICE_X },
    { code: 'C', title: 'Vaults', kind: NodeKind.Vault, x: VAULT_X },
  ]

  const RELATIONS = [
    { id: 'unlocks', from: PASSKEY_X, to: DEVICE_X, verb: 'Unlocks' },
    { id: 'opens', from: DEVICE_X, to: VAULT_X, verb: 'Opens' },
  ]

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const parts = $derived(buildParts(graph))
  const runs = $derived(buildRuns(graph, highlight))
  const anchors = $derived(hereDevices(graph))

  /** Keeps four part rows clear of each other inside the sheet height. */
  function nodeY(count: number, index: number): number {
    return 10 + ((index + 1) / (count + 1)) * 84
  }

  function bandX(
    band: { start: number; end: number },
    count: number,
    index: number,
  ): number {
    return band.start + ((index + 1) / (count + 1)) * (band.end - band.start)
  }

  function passkeyY(graph: KeyGraph, id: string): number {
    return nodeY(
      graph.passkeys.length,
      graph.passkeys.findIndex((passkey) => passkey.id === id),
    )
  }

  function deviceY(graph: KeyGraph, id: string): number {
    return nodeY(
      graph.devices.length,
      graph.devices.findIndex((device) => device.id === id),
    )
  }

  function vaultY(graph: KeyGraph, id: string): number {
    return nodeY(
      graph.vaults.length,
      graph.vaults.findIndex((vault) => vault.id === id),
    )
  }

  /** Routed as a drafting run: out of the part, along the band, into the part. */
  function route(
    x1: number,
    y1: number,
    mid: number,
    x2: number,
    y2: number,
  ): string {
    return `${x1.toFixed(2)},${y1.toFixed(2)} ${mid.toFixed(2)},${y1.toFixed(2)} ${mid.toFixed(2)},${y2.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`
  }

  function buildParts(graph: KeyGraph): Part[] {
    const passkeys: Part[] = graph.passkeys.map((passkey, index) => ({
      key: `pk-${passkey.id}`,
      kind: NodeKind.Passkey,
      id: passkey.id,
      shortId: passkey.shortId,
      label: passkey.label,
      where: storeLabel(passkey.store),
      state: passkey.reach === Reach.Here ? 'On this browser' : 'Elsewhere',
      here: passkey.reach === Reach.Here,
      wires: devicesForPasskey(graph, passkey.id).map(
        (device) => device.shortId,
      ),
      x: PASSKEY_X,
      y: nodeY(graph.passkeys.length, index),
    }))
    const devices: Part[] = graph.devices.map((device, index) => ({
      key: `dk-${device.id}`,
      kind: NodeKind.Device,
      id: device.id,
      shortId: device.shortId,
      label: device.label,
      where: device.platform,
      state: isHere(graph, device) ? 'This browser' : 'Other device',
      here: isHere(graph, device),
      wires: [
        ...passkeysForDevice(graph, device).map((passkey) => passkey.shortId),
        ...vaultsForDevice(graph, device.id).map((vault) => vault.shortId),
      ],
      x: DEVICE_X,
      y: nodeY(graph.devices.length, index),
    }))
    const vaults: Part[] = graph.vaults.map((vault, index) => ({
      key: `vt-${vault.id}`,
      kind: NodeKind.Vault,
      id: vault.id,
      shortId: vault.shortId,
      label: vault.label,
      where: `${vault.secrets} secrets`,
      state: openableHere(graph, vault) ? 'Opens here' : 'Not from here',
      here: openableHere(graph, vault),
      wires: devicesForVault(graph, vault).map((device) => device.shortId),
      x: VAULT_X,
      y: nodeY(graph.vaults.length, index),
    }))
    return [...passkeys, ...devices, ...vaults]
  }

  function buildRuns(graph: KeyGraph, highlight: Highlight): Run[] {
    const unlockPairs = graph.devices.flatMap((device) =>
      device.passkeyIds.map((passkeyId) => ({
        passkeyId,
        deviceId: device.id,
      })),
    )
    const unlocks: Run[] = unlockPairs.map((pair, index) => ({
      id: `u-${pair.passkeyId}-${pair.deviceId}`,
      points: route(
        PASSKEY_X,
        passkeyY(graph, pair.passkeyId),
        bandX(UNLOCK_BAND, unlockPairs.length, index),
        DEVICE_X,
        deviceY(graph, pair.deviceId),
      ),
      lit: edgeLit(highlight, NodeKind.Passkey, pair.passkeyId, pair.deviceId),
    }))
    const openPairs = graph.vaults.flatMap((vault) =>
      vault.deviceIds.map((deviceId) => ({ vaultId: vault.id, deviceId })),
    )
    const opens: Run[] = openPairs.map((pair, index) => ({
      id: `o-${pair.deviceId}-${pair.vaultId}`,
      points: route(
        DEVICE_X,
        deviceY(graph, pair.deviceId),
        bandX(OPEN_BAND, openPairs.length, index),
        VAULT_X,
        vaultY(graph, pair.vaultId),
      ),
      lit: edgeLit(highlight, NodeKind.Device, pair.deviceId, pair.vaultId),
    }))
    return [...unlocks, ...opens]
  }

  function partsOf(kind: NodeKind): Part[] {
    return parts.filter((part) => part.kind === kind)
  }

  function kindTag(kind: NodeKind): string {
    if (kind === NodeKind.Passkey) return 'PK'
    return kind === NodeKind.Device ? 'DK' : 'VT'
  }

  function lit(part: Part): boolean {
    if (part.kind === NodeKind.Passkey)
      return highlight.passkeyIds.includes(part.id)
    if (part.kind === NodeKind.Device)
      return highlight.deviceIds.includes(part.id)
    return highlight.vaultIds.includes(part.id)
  }

  function chosen(part: Part): boolean {
    return selected.kind === part.kind && selected.id === part.id
  }

  function pick(part: Part) {
    selected = { kind: part.kind, id: part.id }
  }

  function frameClass(part: Part): string {
    if (chosen(part)) return 'border-[#7fd4f5] bg-[#0d2a40]'
    if (lit(part)) return 'border-[#2f7fa8] bg-[#082033]'
    return 'border-[#123f60] bg-[#071a2b]'
  }

  function inkClass(part: Part): string {
    return lit(part) ? 'opacity-100' : 'opacity-30'
  }

  function stateInk(part: Part): string {
    return part.here ? 'text-[#7fd4f5]' : 'text-[#e8886a]'
  }
</script>

<main class={`min-h-[100svh] bg-[#061423] text-[#cfe9f7] ${GRID}`}>
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-6xl px-4 pt-28 pb-16 sm:px-8 sm:pt-24 sm:pb-20">
    <div class="border border-[#1d5c86] bg-[#061423]/85">
      <header
        class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#1d5c86] px-4 py-2.5 font-mono text-[10px] tracking-[0.22em] text-[#4d8fb5] uppercase sm:px-5"
      >
        <span>Nook · access plan</span>
        <span>{graph.label} · sheet 1/1</span>
      </header>

      <div class="grid lg:grid-cols-[1fr_19rem]">
        <div class="border-b border-[#123f60] lg:border-r lg:border-b-0">
          <div class="overflow-x-auto px-4 py-5 sm:px-5">
            <div class="relative h-[34rem] min-w-[42rem]">
              <span
                class="absolute top-0 bottom-0 left-0 w-px bg-[#123f60]"
                aria-hidden="true"
              ></span>
              {#each RULE_TICKS as tick (tick)}
                <span
                  class="absolute left-0 h-px w-2 bg-[#1d5c86]"
                  style={`top:${tick}%`}
                  aria-hidden="true"
                ></span>
              {/each}

              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                class="absolute inset-0 h-full w-full"
                aria-hidden="true"
                focusable="false"
              >
                {#each runs as run (run.id)}
                  <polyline
                    points={run.points}
                    fill="none"
                    vector-effect="non-scaling-stroke"
                    stroke-width={run.lit ? 1.6 : 1}
                    class={run.lit ? 'stroke-[#7fd4f5]' : 'stroke-[#123f60]'}
                  />
                {/each}
              </svg>

              {#each STATIONS as station (station.code)}
                <span
                  class="absolute top-0 -translate-x-1/2 font-mono text-[9px] tracking-[0.22em] text-[#4d8fb5] uppercase"
                  style={`left:${station.x}%`}
                >
                  {station.code} · {station.title} · {partsOf(station.kind)
                    .length}
                </span>
              {/each}

              {#each RELATIONS as relation (relation.id)}
                <div
                  class="absolute flex -translate-y-1/2 items-center gap-1.5"
                  style={`left:${relation.from}%;width:${relation.to - relation.from}%;top:7%`}
                  aria-hidden="true"
                >
                  <span class="h-2 w-px bg-[#1d5c86]"></span>
                  <span class="h-px flex-1 bg-[#1d5c86]"></span>
                  <span
                    class="font-mono text-[8px] tracking-[0.24em] text-[#4d8fb5] uppercase"
                  >
                    {relation.verb}
                  </span>
                  <span class="h-px flex-1 bg-[#1d5c86]"></span>
                  <span class="h-2 w-px bg-[#1d5c86]"></span>
                </div>
              {/each}

              {#each parts as part (part.key)}
                <button
                  type="button"
                  aria-pressed={chosen(part)}
                  aria-label={`${kindLabel(part.kind)} ${part.shortId}, ${part.label}, ${part.state}`}
                  class={`absolute w-[9rem] -translate-x-1/2 -translate-y-1/2 border text-left transition motion-reduce:transition-none ${frameClass(part)}`}
                  style={`left:${part.x}%;top:${part.y}%`}
                  onclick={() => pick(part)}
                >
                  <span
                    class={`flex items-baseline justify-between gap-1 border-b border-[#123f60] px-2 py-1 ${inkClass(part)}`}
                  >
                    <span class="font-mono text-[12px] text-[#7fd4f5]">
                      {part.shortId}
                    </span>
                    <span
                      class="font-mono text-[8px] tracking-[0.18em] text-[#4d8fb5]"
                    >
                      {kindTag(part.kind)}
                    </span>
                  </span>
                  <span class={`block px-2 py-1.5 ${inkClass(part)}`}>
                    <span class="block truncate text-[12px]">{part.label}</span>
                    <span class="block truncate text-[10px] text-[#6aa8c9]">
                      {part.where}
                    </span>
                    <span
                      class={`mt-1 block truncate font-mono text-[8px] tracking-[0.16em] uppercase ${stateInk(part)}`}
                    >
                      {part.state}
                    </span>
                  </span>
                  <span
                    class="absolute -top-px -left-px size-1.5 border-t border-l border-[#7fd4f5]"
                    aria-hidden="true"
                  ></span>
                  <span
                    class="absolute -right-px -bottom-px size-1.5 border-r border-b border-[#7fd4f5]"
                    aria-hidden="true"
                  ></span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <aside class="min-w-0 px-4 py-5 sm:px-5">
          <p
            class="font-mono text-[9px] tracking-[0.26em] text-[#4d8fb5] uppercase"
          >
            Parts schedule
          </p>

          {#each STATIONS as station (station.code)}
            <p
              class="mt-4 flex items-baseline justify-between gap-2 border-t border-[#123f60] pt-2 font-mono text-[9px] tracking-[0.18em] text-[#4d8fb5] uppercase"
            >
              <span>{station.code} · {station.title}</span>
              <span>{partsOf(station.kind).length}</span>
            </p>

            {#each partsOf(station.kind) as part (part.key)}
              <button
                type="button"
                aria-pressed={chosen(part)}
                class={`mt-1.5 block w-full border px-2 py-1.5 text-left transition motion-reduce:transition-none ${frameClass(part)}`}
                onclick={() => pick(part)}
              >
                <span
                  class={`flex flex-wrap items-baseline gap-x-2 gap-y-1 ${inkClass(part)}`}
                >
                  <span class="font-mono text-[12px] text-[#7fd4f5]">
                    {part.shortId}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-[11px]">
                    {part.label}
                  </span>
                  <span
                    class={`font-mono text-[8px] tracking-[0.14em] uppercase ${stateInk(part)}`}
                  >
                    {part.state}
                  </span>
                </span>
                <span
                  class={`mt-1 block truncate text-[10px] text-[#6aa8c9] ${inkClass(part)}`}
                >
                  {part.where}
                </span>
                <span
                  class={`mt-1 flex flex-wrap items-center gap-1 ${inkClass(part)}`}
                >
                  <span
                    class="font-mono text-[8px] tracking-[0.16em] text-[#4d8fb5] uppercase"
                  >
                    Wires
                  </span>
                  {#each part.wires as wire (wire)}
                    <span
                      class="border border-[#1d5c86] px-1 font-mono text-[9px] text-[#9fd0e8]"
                    >
                      {wire}
                    </span>
                  {/each}
                  {#if part.wires.length === 0}
                    <span
                      class="border border-dashed border-[#7a4437] px-1 font-mono text-[9px] text-[#e8886a]"
                    >
                      none
                    </span>
                  {/if}
                </span>
              </button>
            {/each}
          {/each}
        </aside>
      </div>

      <div
        class="grid border-t border-[#1d5c86] font-mono text-[10px] sm:grid-cols-3"
      >
        <div
          class="border-b border-[#123f60] px-4 py-3 sm:border-r sm:border-b-0 sm:px-5"
        >
          <p class="tracking-[0.22em] text-[#4d8fb5] uppercase">Drawing</p>
          <p class="mt-1 text-[#cfe9f7]">Passkeys · device keys · vaults</p>
          <p class="mt-1 tracking-[0.14em] text-[#4d8fb5] uppercase">
            Parts {parts.length} · Runs {runs.length}
          </p>
        </div>
        <div
          class="border-b border-[#123f60] px-4 py-3 sm:border-r sm:border-b-0 sm:px-5"
        >
          <p class="tracking-[0.22em] text-[#4d8fb5] uppercase">This browser</p>
          {#each anchors as anchor (anchor.id)}
            <p class="mt-1 text-[#7fd4f5]">{anchor.shortId}</p>
            <p class="mt-1 tracking-[0.14em] text-[#4d8fb5] uppercase">
              {anchor.platform}
            </p>
          {/each}
          {#if graph.here.kind === HereKind.Unprepared}
            <p class="mt-1 text-[#e8886a]">No device key</p>
            <p class="mt-1 tracking-[0.14em] text-[#4d8fb5] uppercase">
              Nothing enrolled here
            </p>
          {/if}
        </div>
        <div class="px-4 py-3 sm:px-5">
          <p class="tracking-[0.22em] text-[#4d8fb5] uppercase">Usable here</p>
          <p class="mt-1 text-[#cfe9f7]">
            Passkeys {usableHere(graph).length} / {graph.passkeys.length}
          </p>
          <p class="mt-1 text-[#cfe9f7]">
            Vaults {vaultsOpenableHere(graph).length} / {graph.vaults.length}
          </p>
        </div>
      </div>
    </div>
  </section>
</main>
