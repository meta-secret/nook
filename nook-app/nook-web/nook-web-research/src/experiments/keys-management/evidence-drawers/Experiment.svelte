<!--
DIRECTION: A machined cabinet of the whole graph. Three banks of drawers —
passkeys, device keys, vaults — every face engraved with nothing but its
identifier. Pulling one drawer wires it to the faces it reaches; everything it
cannot reach goes dark. The pulled drawer holds identifier chips, not prose.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault as VaultIcon } from '@lucide/svelte'
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
    KeyStore,
    kindLabel,
    NodeKind,
    type NodeRef,
    openableHere,
    passkeysForDevice,
    passkeysForVault,
    Reach,
    storeLabel,
    vaultsForDevice,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Wire {
    id: string
    x1: number
    y1: number
    x2: number
    y2: number
    lit: boolean
  }

  interface Chip {
    key: string
    kind: NodeKind
    id: string
    shortId: string
    label: string
  }

  interface ChipGroup {
    title: string
    chips: Chip[]
  }

  const BANK_A = 0
  const BANK_B = 37
  const BANK_C = 74
  const BANK_W = 26
  const BODY_H = 17
  const PITCH = 4.25
  const FACE_H = 3.5
  const TRAY_ID = 'evidence-drawer-tray'

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#9aa3ad',
    [KeyStore.Bitwarden]: '#5b86f2',
    [KeyStore.OnePassword]: '#3fae86',
    [KeyStore.SecurityKey]: '#d9a441',
  }

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const wires = $derived(buildWires(graph, highlight))
  const groups = $derived(groupsFor(graph, selected))
  const selectedPasskeys = $derived(
    graph.passkeys.filter(
      (passkey) =>
        selected.kind === NodeKind.Passkey && passkey.id === selected.id,
    ),
  )
  const selectedDevices = $derived(
    graph.devices.filter(
      (device) =>
        selected.kind === NodeKind.Device && device.id === selected.id,
    ),
  )
  const selectedVaults = $derived(
    graph.vaults.filter(
      (vault) => selected.kind === NodeKind.Vault && vault.id === selected.id,
    ),
  )

  function rowY(count: number, index: number): number {
    const stack = count * PITCH - (PITCH - FACE_H)
    const top = (BODY_H - stack) / 2
    return ((top + index * PITCH + FACE_H / 2) / BODY_H) * 100
  }

  function passkeyY(graph: KeyGraph, id: string): number {
    return rowY(
      graph.passkeys.length,
      graph.passkeys.findIndex((passkey) => passkey.id === id),
    )
  }

  function deviceY(graph: KeyGraph, id: string): number {
    return rowY(
      graph.devices.length,
      graph.devices.findIndex((device) => device.id === id),
    )
  }

  function vaultY(graph: KeyGraph, id: string): number {
    return rowY(
      graph.vaults.length,
      graph.vaults.findIndex((vault) => vault.id === id),
    )
  }

  function buildWires(graph: KeyGraph, highlight: Highlight): Wire[] {
    const unlocks = graph.devices.flatMap((device) =>
      device.passkeyIds.map((passkeyId) => ({
        id: `${passkeyId}>${device.id}`,
        x1: BANK_A + BANK_W,
        y1: passkeyY(graph, passkeyId),
        x2: BANK_B,
        y2: deviceY(graph, device.id),
        lit: edgeLit(highlight, NodeKind.Passkey, passkeyId, device.id),
      })),
    )
    const opens = graph.vaults.flatMap((vault) =>
      vault.deviceIds.map((deviceId) => ({
        id: `${deviceId}>${vault.id}`,
        x1: BANK_B + BANK_W,
        y1: deviceY(graph, deviceId),
        x2: BANK_C,
        y2: vaultY(graph, vault.id),
        lit: edgeLit(highlight, NodeKind.Device, deviceId, vault.id),
      })),
    )
    return [...unlocks, ...opens]
  }

  function passkeyChips(graph: KeyGraph, ids: readonly string[]): Chip[] {
    return graph.passkeys
      .filter((passkey) => ids.includes(passkey.id))
      .map((passkey) => ({
        key: `p-${passkey.id}`,
        kind: NodeKind.Passkey,
        id: passkey.id,
        shortId: passkey.shortId,
        label: storeLabel(passkey.store),
      }))
  }

  function deviceChips(graph: KeyGraph, ids: readonly string[]): Chip[] {
    return graph.devices
      .filter((device) => ids.includes(device.id))
      .map((device) => ({
        key: `d-${device.id}`,
        kind: NodeKind.Device,
        id: device.id,
        shortId: device.shortId,
        label: device.label,
      }))
  }

  function vaultChips(graph: KeyGraph, ids: readonly string[]): Chip[] {
    return graph.vaults
      .filter((vault) => ids.includes(vault.id))
      .map((vault) => ({
        key: `v-${vault.id}`,
        kind: NodeKind.Vault,
        id: vault.id,
        shortId: vault.shortId,
        label: vault.label,
      }))
  }

  function groupsFor(graph: KeyGraph, node: NodeRef): ChipGroup[] {
    if (node.kind === NodeKind.Passkey) {
      const devices = devicesForPasskey(graph, node.id)
      return [
        {
          title: 'Unlocks device keys',
          chips: deviceChips(
            graph,
            devices.map((device) => device.id),
          ),
        },
        {
          title: 'Opens vaults',
          chips: vaultChips(
            graph,
            vaultsForPasskey(graph, node.id).map((vault) => vault.id),
          ),
        },
      ]
    }
    if (node.kind === NodeKind.Device) {
      const devices = graph.devices.filter((device) => device.id === node.id)
      return [
        {
          title: 'Unlocked by passkeys',
          chips: passkeyChips(
            graph,
            devices.flatMap((device) =>
              passkeysForDevice(graph, device).map((passkey) => passkey.id),
            ),
          ),
        },
        {
          title: 'Opens vaults',
          chips: vaultChips(
            graph,
            vaultsForDevice(graph, node.id).map((vault) => vault.id),
          ),
        },
      ]
    }
    const vaults = graph.vaults.filter((vault) => vault.id === node.id)
    return [
      {
        title: 'Opened by passkeys',
        chips: passkeyChips(
          graph,
          vaults.flatMap((vault) =>
            passkeysForVault(graph, vault).map((passkey) => passkey.id),
          ),
        ),
      },
      {
        title: 'Through device keys',
        chips: deviceChips(
          graph,
          vaults.flatMap((vault) =>
            devicesForVault(graph, vault).map((device) => device.id),
          ),
        ),
      },
    ]
  }

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function isSelected(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function faceTone(lit: boolean, chosen: boolean): string {
    if (chosen) {
      return 'border-[#d9a441] shadow-[0_12px_26px_rgb(0_0_0/0.6)] translate-x-1.5'
    }
    if (lit) return 'border-[#8a6c2c] shadow-[0_4px_10px_rgb(0_0_0/0.35)]'
    return 'border-[#31383f] opacity-25 grayscale'
  }

  function pullTone(lit: boolean, chosen: boolean): string {
    if (chosen || lit) {
      return 'bg-[repeating-linear-gradient(90deg,#d9a441_0_1px,#3b3018_1px_3px)]'
    }
    return 'bg-[repeating-linear-gradient(90deg,#5b646d_0_1px,#2c3238_1px_3px)]'
  }

  function portTone(lit: boolean): string {
    return lit ? 'bg-[#d9a441]' : 'bg-[#3a424b]'
  }

  function bankTone(count: number): string {
    return count > 0 ? 'text-[#d9a441]' : 'text-[#4f5862]'
  }

  function idTone(lit: boolean): string {
    return lit ? 'text-[#f2e2bd]' : 'text-[#c3ccd5]'
  }
</script>

<main class="min-h-[100svh] bg-[#0b0d10] text-[#dfe4ea]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-5xl px-4 pt-28 pb-16 sm:px-8 sm:pt-24">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="font-mono text-[10px] tracking-[0.24em] text-[#6d7680] uppercase"
      >
        This browser
      </span>
      {#each hereDevices(graph) as device (device.id)}
        <span
          class="rounded border border-[#8a6c2c] px-2 py-0.5 font-mono text-[11px] text-[#d9a441]"
        >
          {device.shortId}
        </span>
      {/each}
      {#if graph.here.kind === HereKind.Unprepared}
        <span
          class="rounded border border-dashed border-[#4a525b] px-2 py-0.5 font-mono text-[11px] text-[#8b949e]"
        >
          no device key
        </span>
      {/if}
    </div>

    <div class="mt-5 overflow-x-auto pb-3">
      <div
        class="min-w-[52rem] rounded-md border border-[#2a3038] bg-[linear-gradient(180deg,#1b1f24_0%,#141719_100%)] p-5 shadow-[0_30px_70px_rgb(0_0_0/0.55)]"
      >
        <div class="relative h-5">
          {#each [{ x: BANK_A, text: 'Passkeys', count: highlight.passkeyIds.length }, { x: BANK_B, text: 'Device keys', count: highlight.deviceIds.length }, { x: BANK_C, text: 'Vaults', count: highlight.vaultIds.length }] as bank (bank.text)}
            <span
              class={`absolute top-0 font-mono text-[10px] tracking-[0.24em] uppercase ${bankTone(bank.count)}`}
              style={`left:${bank.x}%`}
            >
              {bank.text}
            </span>
          {/each}
        </div>

        <div class="relative h-[17rem]">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            class="absolute inset-0 h-full w-full"
            aria-hidden="true"
            focusable="false"
          >
            {#each wires as wire (wire.id)}
              <line
                x1={wire.x1}
                y1={wire.y1}
                x2={wire.x2}
                y2={wire.y2}
                vector-effect="non-scaling-stroke"
                stroke-width={wire.lit ? 1.6 : 1}
                class={wire.lit ? 'stroke-[#d9a441]' : 'stroke-[#232a31]'}
              />
            {/each}
          </svg>

          {#each graph.passkeys as passkey, index (passkey.id)}
            {@const lit = highlight.passkeyIds.includes(passkey.id)}
            {@const chosen = isSelected(NodeKind.Passkey, passkey.id)}
            <button
              type="button"
              aria-pressed={chosen}
              aria-controls={TRAY_ID}
              aria-label={`Passkey ${passkey.shortId}, ${passkey.label}`}
              class={`absolute flex h-14 -translate-y-1/2 flex-col justify-center rounded-sm border bg-[linear-gradient(180deg,#333a42_0%,#272c33_55%,#1e2228_100%)] px-2.5 text-left transition duration-300 motion-reduce:transition-none ${faceTone(lit, chosen)}`}
              style={`left:${BANK_A}%;top:${rowY(graph.passkeys.length, index)}%;width:${BANK_W}%`}
              onclick={() => pick(NodeKind.Passkey, passkey.id)}
            >
              <span class="flex items-center gap-2">
                <Fingerprint
                  class="size-3.5 shrink-0 text-[#7d8791]"
                  aria-hidden="true"
                />
                <span
                  class={`font-mono text-[15px] tracking-[0.08em] ${idTone(lit)}`}
                >
                  {passkey.shortId}
                </span>
                <span
                  class={`ml-auto h-4 w-6 shrink-0 rounded-[2px] ${pullTone(lit, chosen)}`}
                  aria-hidden="true"
                ></span>
              </span>
              <span class="mt-1 flex items-center gap-1.5">
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  style={`background:${STORE_INK[passkey.store]}`}
                  aria-hidden="true"
                ></span>
                <span
                  class="truncate font-mono text-[9px] tracking-[0.1em] text-[#8b949e] uppercase"
                >
                  {storeLabel(passkey.store)}
                </span>
                {#if passkey.reach === Reach.Elsewhere}
                  <span
                    class="ml-auto shrink-0 font-mono text-[9px] tracking-[0.1em] text-[#6d7680] uppercase"
                  >
                    elsewhere
                  </span>
                {/if}
              </span>
              <span
                class={`absolute top-1/2 -right-1 size-2 -translate-y-1/2 rounded-full ${portTone(lit)}`}
                aria-hidden="true"
              ></span>
            </button>
          {/each}

          {#each graph.devices as device, index (device.id)}
            {@const lit = highlight.deviceIds.includes(device.id)}
            {@const chosen = isSelected(NodeKind.Device, device.id)}
            <button
              type="button"
              aria-pressed={chosen}
              aria-controls={TRAY_ID}
              aria-label={`Device key ${device.shortId}, ${device.label}`}
              class={`absolute flex h-14 -translate-y-1/2 flex-col justify-center rounded-sm border bg-[linear-gradient(180deg,#333a42_0%,#272c33_55%,#1e2228_100%)] px-2.5 text-left transition duration-300 motion-reduce:transition-none ${faceTone(lit, chosen)}`}
              style={`left:${BANK_B}%;top:${rowY(graph.devices.length, index)}%;width:${BANK_W}%`}
              onclick={() => pick(NodeKind.Device, device.id)}
            >
              <span class="flex items-center gap-2">
                <Laptop
                  class="size-3.5 shrink-0 text-[#7d8791]"
                  aria-hidden="true"
                />
                <span
                  class={`font-mono text-[15px] tracking-[0.08em] ${idTone(lit)}`}
                >
                  {device.shortId}
                </span>
                <span
                  class={`ml-auto h-4 w-6 shrink-0 rounded-[2px] ${pullTone(lit, chosen)}`}
                  aria-hidden="true"
                ></span>
              </span>
              <span class="mt-1 flex items-center gap-1.5">
                <span class="truncate text-[10px] text-[#8b949e]">
                  {device.label}
                </span>
                {#if isHere(graph, device)}
                  <span
                    class="ml-auto shrink-0 font-mono text-[9px] tracking-[0.1em] text-[#d9a441] uppercase"
                  >
                    here
                  </span>
                {/if}
              </span>
              <span
                class={`absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full ${portTone(lit)}`}
                aria-hidden="true"
              ></span>
              <span
                class={`absolute top-1/2 -right-1 size-2 -translate-y-1/2 rounded-full ${portTone(lit)}`}
                aria-hidden="true"
              ></span>
            </button>
          {/each}

          {#each graph.vaults as vault, index (vault.id)}
            {@const lit = highlight.vaultIds.includes(vault.id)}
            {@const chosen = isSelected(NodeKind.Vault, vault.id)}
            <button
              type="button"
              aria-pressed={chosen}
              aria-controls={TRAY_ID}
              aria-label={`Vault ${vault.shortId}, ${vault.label}`}
              class={`absolute flex h-14 -translate-y-1/2 flex-col justify-center rounded-sm border bg-[linear-gradient(180deg,#333a42_0%,#272c33_55%,#1e2228_100%)] px-2.5 text-left transition duration-300 motion-reduce:transition-none ${faceTone(lit, chosen)}`}
              style={`left:${BANK_C}%;top:${rowY(graph.vaults.length, index)}%;width:${BANK_W}%`}
              onclick={() => pick(NodeKind.Vault, vault.id)}
            >
              <span class="flex items-center gap-2">
                <VaultIcon
                  class="size-3.5 shrink-0 text-[#7d8791]"
                  aria-hidden="true"
                />
                <span
                  class={`font-mono text-[15px] tracking-[0.08em] ${idTone(lit)}`}
                >
                  {vault.shortId}
                </span>
                <span
                  class={`ml-auto h-4 w-6 shrink-0 rounded-[2px] ${pullTone(lit, chosen)}`}
                  aria-hidden="true"
                ></span>
              </span>
              <span class="mt-1 flex items-center gap-1.5">
                <span class="truncate text-[10px] text-[#8b949e]">
                  {vault.label}
                </span>
                <span
                  class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.1em] uppercase ${
                    openableHere(graph, vault)
                      ? 'text-[#d9a441]'
                      : 'text-[#6d7680]'
                  }`}
                >
                  {openableHere(graph, vault) ? 'opens here' : 'locked here'}
                </span>
              </span>
              <span
                class={`absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full ${portTone(lit)}`}
                aria-hidden="true"
              ></span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    <div
      id={TRAY_ID}
      class="mt-5 rounded-md border border-[#8a6c2c] bg-[linear-gradient(180deg,#1e2228_0%,#15181c_100%)] shadow-[0_20px_50px_rgb(0_0_0/0.5)]"
    >
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#2a3038] px-4 py-3"
      >
        <span
          class="font-mono text-[10px] tracking-[0.24em] text-[#6d7680] uppercase"
        >
          {kindLabel(selected.kind)}
        </span>
        {#each selectedPasskeys as passkey (passkey.id)}
          <span class="font-mono text-lg tracking-[0.1em] text-[#f2e2bd]">
            {passkey.shortId}
          </span>
          <span class="text-[13px] text-[#9aa4ae]">{passkey.label}</span>
          <span class="flex items-center gap-1.5">
            <span
              class="size-2 rounded-full"
              style={`background:${STORE_INK[passkey.store]}`}
              aria-hidden="true"
            ></span>
            <span class="text-[12px] text-[#c3ccd5]">
              {storeLabel(passkey.store)}
            </span>
          </span>
          <span
            class={`ml-auto rounded px-2 py-1 font-mono text-[10px] tracking-[0.14em] uppercase ${
              passkey.reach === Reach.Here
                ? 'bg-[#2c2412] text-[#d9a441]'
                : 'bg-[#22272c] text-[#8b949e]'
            }`}
          >
            {passkey.reach === Reach.Here
              ? 'usable here'
              : 'not on this device'}
          </span>
        {/each}
        {#each selectedDevices as device (device.id)}
          <span class="font-mono text-lg tracking-[0.1em] text-[#f2e2bd]">
            {device.shortId}
          </span>
          <span class="text-[13px] text-[#9aa4ae]">{device.label}</span>
          <span class="text-[12px] text-[#c3ccd5]">{device.platform}</span>
          <span
            class={`ml-auto rounded px-2 py-1 font-mono text-[10px] tracking-[0.14em] uppercase ${
              isHere(graph, device)
                ? 'bg-[#2c2412] text-[#d9a441]'
                : 'bg-[#22272c] text-[#8b949e]'
            }`}
          >
            {isHere(graph, device) ? 'this browser' : 'another device'}
          </span>
        {/each}
        {#each selectedVaults as vault (vault.id)}
          <span class="font-mono text-lg tracking-[0.1em] text-[#f2e2bd]">
            {vault.shortId}
          </span>
          <span class="text-[13px] text-[#9aa4ae]">{vault.label}</span>
          <span class="font-mono text-[12px] text-[#c3ccd5]">
            {vault.secrets} secrets
          </span>
          <span
            class={`ml-auto rounded px-2 py-1 font-mono text-[10px] tracking-[0.14em] uppercase ${
              openableHere(graph, vault)
                ? 'bg-[#2c2412] text-[#d9a441]'
                : 'bg-[#22272c] text-[#8b949e]'
            }`}
          >
            {openableHere(graph, vault) ? 'opens here' : 'locked here'}
          </span>
        {/each}
      </div>

      <div class="grid gap-x-8 gap-y-4 px-4 py-4 sm:grid-cols-2">
        {#each groups as group (group.title)}
          <div>
            <p
              class="font-mono text-[10px] tracking-[0.2em] text-[#6d7680] uppercase"
            >
              {group.title}
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              {#each group.chips as chip (chip.key)}
                <button
                  type="button"
                  class="flex items-baseline gap-2 rounded border border-[#3d454e] bg-[#22272c] px-2 py-1.5 transition hover:border-[#d9a441] motion-reduce:transition-none"
                  onclick={() => pick(chip.kind, chip.id)}
                >
                  <span class="font-mono text-[13px] text-[#f2e2bd]">
                    {chip.shortId}
                  </span>
                  <span class="text-[10px] text-[#8b949e]">{chip.label}</span>
                </button>
              {/each}
              {#if group.chips.length === 0}
                <span
                  class="rounded border border-dashed border-[#3d454e] px-2 py-1.5 font-mono text-[12px] text-[#6d7680]"
                >
                  none
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>
</main>
