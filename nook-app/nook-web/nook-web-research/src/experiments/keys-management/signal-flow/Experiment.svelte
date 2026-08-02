<script lang="ts">
  import { Fingerprint, Laptop, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    edgeLit,
    GraphId,
    graphById,
    type Highlight,
    highlightFor,
    isHere,
    type KeyGraph,
    KeyStore,
    NodeKind,
    type NodeRef,
    openableHere,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Edge {
    id: string
    x1: number
    y1: number
    x2: number
    y2: number
    lit: boolean
  }

  const PASSKEY_Y = 13
  const DEVICE_Y = 50
  const VAULT_Y = 87

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#9aa3ad',
    [KeyStore.Bitwarden]: '#4d7cfe',
    [KeyStore.OnePassword]: '#2fa37c',
    [KeyStore.SecurityKey]: '#e0a33b',
  }

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const edges = $derived(buildEdges(graph, highlight))
  const selectedVaults = $derived(
    graph.vaults.filter(
      (vault) => selected.kind === NodeKind.Vault && vault.id === selected.id,
    ),
  )

  function spread(count: number, index: number): number {
    return ((index + 1) / (count + 1)) * 100
  }

  function passkeyX(graph: KeyGraph, id: string): number {
    return spread(
      graph.passkeys.length,
      graph.passkeys.findIndex((passkey) => passkey.id === id),
    )
  }

  function deviceX(graph: KeyGraph, id: string): number {
    return spread(
      graph.devices.length,
      graph.devices.findIndex((device) => device.id === id),
    )
  }

  function vaultX(graph: KeyGraph, id: string): number {
    return spread(
      graph.vaults.length,
      graph.vaults.findIndex((vault) => vault.id === id),
    )
  }

  function buildEdges(graph: KeyGraph, highlight: Highlight): Edge[] {
    const unlocks = graph.devices.flatMap((device) =>
      device.passkeyIds.map((passkeyId) => ({
        id: `${passkeyId}-${device.id}`,
        x1: passkeyX(graph, passkeyId),
        y1: PASSKEY_Y,
        x2: deviceX(graph, device.id),
        y2: DEVICE_Y,
        lit: edgeLit(highlight, NodeKind.Passkey, passkeyId, device.id),
      })),
    )
    const opens = graph.vaults.flatMap((vault) =>
      vault.deviceIds.map((deviceId) => ({
        id: `${deviceId}-${vault.id}`,
        x1: deviceX(graph, deviceId),
        y1: DEVICE_Y,
        x2: vaultX(graph, vault.id),
        y2: VAULT_Y,
        lit: edgeLit(highlight, NodeKind.Device, deviceId, vault.id),
      })),
    )
    return [...unlocks, ...opens]
  }

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function isSelected(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function litClass(lit: boolean, chosen: boolean): string {
    if (chosen) return 'border-[#7ce0c0] bg-[#0e1c19] opacity-100'
    if (lit) return 'border-[#2f5049] bg-[#0b1412] opacity-100'
    return 'border-[#1e2126] bg-[#0a0c0e] opacity-30'
  }

  function vaultChips(vault: Vault): string[] {
    return passkeysForVault(graph, vault).map((passkey) => passkey.shortId)
  }
</script>

<main class="min-h-[100svh] bg-[#05070a] text-[#dfe5ea]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-5xl px-4 py-20 sm:px-8">
    <div class="overflow-x-auto pb-3">
      <div class="relative h-[34rem] min-w-[40rem]">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          class="absolute inset-0 h-full w-full"
          aria-hidden="true"
          focusable="false"
        >
          {#each edges as edge (edge.id)}
            <line
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              vector-effect="non-scaling-stroke"
              stroke-width={edge.lit ? 1.6 : 1}
              class={edge.lit ? 'stroke-[#4ad6a8]' : 'stroke-[#1b2026]'}
            />
          {/each}
        </svg>

        {#each [{ y: PASSKEY_Y, text: 'Passkeys' }, { y: DEVICE_Y, text: 'Device keys' }, { y: VAULT_Y, text: 'Vaults' }] as row (row.text)}
          <span
            class="absolute left-0 -translate-y-1/2 font-mono text-[9px] tracking-[0.2em] text-[#48525c] uppercase"
            style={`top:${row.y}%`}
          >
            {row.text}
          </span>
        {/each}

        {#each graph.passkeys as passkey (passkey.id)}
          <button
            type="button"
            aria-pressed={isSelected(NodeKind.Passkey, passkey.id)}
            class={`absolute w-[9rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border px-3 py-2.5 text-left transition ${litClass(
              highlight.passkeyIds.includes(passkey.id),
              isSelected(NodeKind.Passkey, passkey.id),
            )}`}
            style={`left:${passkeyX(graph, passkey.id)}%;top:${PASSKEY_Y}%`}
            onclick={() => pick(NodeKind.Passkey, passkey.id)}
          >
            <span class="flex items-center gap-1.5">
              <Fingerprint class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="truncate text-[13px]">{passkey.label}</span>
            </span>
            <span class="mt-1.5 flex items-center gap-1.5">
              <span
                class="size-2 shrink-0 rounded-full"
                style={`background:${STORE_INK[passkey.store]}`}
                aria-hidden="true"
              ></span>
              <span class="truncate text-[10px] text-[#8e9aa5]">
                {storeLabel(passkey.store)}
              </span>
            </span>
            <span class="mt-1.5 block font-mono text-[11px] text-[#7ce0c0]">
              {passkey.shortId}
            </span>
            {#if passkey.reach === Reach.Elsewhere}
              <span
                class="mt-1 block font-mono text-[9px] tracking-[0.14em] text-[#6a747e] uppercase"
              >
                Not on this computer
              </span>
            {/if}
          </button>
        {/each}

        {#each graph.devices as device (device.id)}
          <button
            type="button"
            aria-pressed={isSelected(NodeKind.Device, device.id)}
            class={`absolute w-[9rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border px-3 py-2.5 text-left transition ${litClass(
              highlight.deviceIds.includes(device.id),
              isSelected(NodeKind.Device, device.id),
            )}`}
            style={`left:${deviceX(graph, device.id)}%;top:${DEVICE_Y}%`}
            onclick={() => pick(NodeKind.Device, device.id)}
          >
            <span class="flex items-center gap-1.5">
              <Laptop class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="truncate text-[13px]">{device.label}</span>
            </span>
            <span class="mt-1 block truncate text-[10px] text-[#8e9aa5]">
              {device.platform}
            </span>
            <span class="mt-1.5 block font-mono text-[11px] text-[#7ce0c0]">
              {device.shortId}
            </span>
            {#if isHere(graph, device)}
              <span
                class="mt-1 block font-mono text-[9px] tracking-[0.14em] text-[#4ad6a8] uppercase"
              >
                You are here
              </span>
            {/if}
          </button>
        {/each}

        {#each graph.vaults as vault (vault.id)}
          <button
            type="button"
            aria-pressed={isSelected(NodeKind.Vault, vault.id)}
            class={`absolute w-[8.5rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border px-3 py-2.5 text-left transition ${
              openableHere(graph, vault) ? '' : 'border-dashed'
            } ${litClass(
              highlight.vaultIds.includes(vault.id),
              isSelected(NodeKind.Vault, vault.id),
            )}`}
            style={`left:${vaultX(graph, vault.id)}%;top:${VAULT_Y}%`}
            onclick={() => pick(NodeKind.Vault, vault.id)}
          >
            <span class="flex items-center gap-1.5">
              <VaultIcon class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="truncate text-[13px]">{vault.label}</span>
            </span>
            <span class="mt-1.5 block font-mono text-[11px] text-[#7ce0c0]">
              {vault.shortId}
            </span>
            <span class="mt-1 block text-[10px] text-[#8e9aa5]">
              {vault.secrets} secrets
            </span>
          </button>
        {/each}
      </div>
    </div>

    {#each selectedVaults as vault (vault.id)}
      <div
        class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[#1e2126] px-4 py-3"
      >
        <span
          class="font-mono text-[10px] tracking-[0.18em] text-[#48525c] uppercase"
        >
          Opened by
        </span>
        {#each vaultChips(vault) as chip (chip)}
          <span
            class="rounded-md border border-[#2f5049] px-2 py-1 font-mono text-[11px] text-[#7ce0c0]"
          >
            {chip}
          </span>
        {/each}
        <span
          class={`ml-auto rounded-md px-2 py-1 font-mono text-[10px] tracking-[0.14em] uppercase ${
            openableHere(graph, vault)
              ? 'bg-[#12261f] text-[#4ad6a8]'
              : 'bg-[#261a12] text-[#e0a33b]'
          }`}
        >
          {openableHere(graph, vault) ? 'Opens here' : 'Not from this browser'}
        </span>
      </div>
    {/each}
  </section>
</main>
