<!--
DIRECTION: A patch panel. Passkeys down the side, vaults across the top, and in
every cell the device key that carries the route — so "which of my three
passkeys opens this vault" is answered by looking down one column. The strip
above counts only what this browser can do right now.
-->
<script lang="ts">
  import {
    Fingerprint,
    Laptop,
    TriangleAlert,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    type Device,
    devicesForVault,
    GraphId,
    graphById,
    hereDevices,
    highlightFor,
    isHere,
    type KeyGraph,
    kindLabel,
    NodeKind,
    type NodeRef,
    openableHere,
    type Passkey,
    passkeysForVault,
    Reach,
    storeLabel,
    usableHere,
    type Vault,
    vaultsOpenableHere,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  interface Readout {
    label: string
    items: readonly { id: string; shortId: string }[]
  }

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const here = $derived(hereDevices(graph))
  const usable = $derived(usableHere(graph))
  const openHere = $derived(vaultsOpenableHere(graph))
  const lonely = $derived(graph.vaults.filter((vault) => single(vault)))
  const chosenShortId = $derived(shortIdOf(graph, selected))
  const readout = $derived<Readout[]>([
    {
      label: 'Passkeys',
      items: graph.passkeys.filter((passkey) =>
        highlight.passkeyIds.includes(passkey.id),
      ),
    },
    {
      label: 'Device keys',
      items: graph.devices.filter((device) =>
        highlight.deviceIds.includes(device.id),
      ),
    },
    {
      label: 'Vaults',
      items: graph.vaults.filter((vault) =>
        highlight.vaultIds.includes(vault.id),
      ),
    },
  ])

  /** The device keys that carry this passkey into this vault. */
  function route(passkey: Passkey, vault: Vault): Device[] {
    return devicesForVault(graph, vault).filter((device) =>
      device.passkeyIds.includes(passkey.id),
    )
  }

  function single(vault: Vault): boolean {
    return passkeysForVault(graph, vault).length === 1
  }

  function shortIdOf(graph: KeyGraph, node: NodeRef): string {
    const pool: { id: string; shortId: string }[] = [
      ...graph.passkeys,
      ...graph.devices,
      ...graph.vaults,
    ]
    const match = pool.find((item) => item.id === node.id)
    return match ? match.shortId : ''
  }

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function isSelected(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function cellLit(passkey: Passkey, vault: Vault, routes: Device[]): boolean {
    return (
      highlight.passkeyIds.includes(passkey.id) &&
      highlight.vaultIds.includes(vault.id) &&
      routes.some((device) => highlight.deviceIds.includes(device.id))
    )
  }

  function headTone(chosen: boolean, lit: boolean): string {
    if (chosen) return 'bg-[#16200f]'
    if (lit) return 'bg-[#0f1411]'
    return 'opacity-30 hover:opacity-100 focus-visible:opacity-100'
  }

  function chipTone(chosen: boolean): string {
    return chosen
      ? 'border-[#a6e22e] bg-[#1c2a10] text-[#d7f59a]'
      : 'border-[#33402c] text-[#a6e22e] hover:border-[#a6e22e]'
  }
</script>

<main class="min-h-[100svh] bg-[#08090b] text-[#dfe4dc]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <section class="mx-auto max-w-6xl px-4 pt-28 pb-16 sm:px-6 sm:pt-24">
    <p class="font-mono text-[10px] tracking-[0.3em] text-[#6f7a6a] uppercase">
      Nook · routing
    </p>

    <div
      class="mt-4 grid gap-px overflow-hidden rounded-md border border-[#1b1f24] bg-[#1b1f24] sm:grid-cols-2 lg:grid-cols-4"
    >
      <div class="bg-[#0d1013] px-4 py-3">
        <p
          class="font-mono text-[9px] tracking-[0.18em] text-[#6f7a6a] uppercase"
        >
          Passkeys usable here
        </p>
        <p class="mt-1.5 font-mono text-2xl leading-none text-[#a6e22e]">
          {usable.length}<span class="text-sm text-[#6f7a6a]"
            >/{graph.passkeys.length}</span
          >
        </p>
        <ul class="mt-2 flex flex-wrap gap-1">
          {#each usable as passkey (passkey.id)}
            <li
              class="border border-[#2a3327] px-1.5 py-0.5 font-mono text-[10px] text-[#c7d2c1]"
            >
              {passkey.shortId}
            </li>
          {/each}
          {#if usable.length === 0}
            <li
              class="font-mono text-[10px] tracking-[0.14em] text-[#e0a33b] uppercase"
            >
              None
            </li>
          {/if}
        </ul>
      </div>

      <div class="bg-[#0d1013] px-4 py-3">
        <p
          class="font-mono text-[9px] tracking-[0.18em] text-[#6f7a6a] uppercase"
        >
          Vaults openable here
        </p>
        <p class="mt-1.5 font-mono text-2xl leading-none text-[#a6e22e]">
          {openHere.length}<span class="text-sm text-[#6f7a6a]"
            >/{graph.vaults.length}</span
          >
        </p>
        <ul class="mt-2 flex flex-wrap gap-1">
          {#each openHere as vault (vault.id)}
            <li
              class="border border-[#2a3327] px-1.5 py-0.5 font-mono text-[10px] text-[#c7d2c1]"
            >
              {vault.shortId}
            </li>
          {/each}
          {#if openHere.length === 0}
            <li
              class="font-mono text-[10px] tracking-[0.14em] text-[#e0a33b] uppercase"
            >
              None
            </li>
          {/if}
        </ul>
      </div>

      <div class="bg-[#0d1013] px-4 py-3">
        <p
          class="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.18em] text-[#6f7a6a] uppercase"
        >
          <TriangleAlert class="size-3 text-[#e0a33b]" aria-hidden="true" />
          One passkey only
        </p>
        <p class="mt-1.5 font-mono text-2xl leading-none text-[#e0a33b]">
          {lonely.length}<span class="text-sm text-[#6f7a6a]"
            >/{graph.vaults.length}</span
          >
        </p>
        <ul class="mt-2 flex flex-wrap gap-1">
          {#each lonely as vault (vault.id)}
            <li
              class="border border-[#40361f] px-1.5 py-0.5 font-mono text-[10px] text-[#e0a33b]"
            >
              {vault.shortId}
            </li>
          {/each}
          {#if lonely.length === 0}
            <li
              class="font-mono text-[10px] tracking-[0.14em] text-[#6f7a6a] uppercase"
            >
              None
            </li>
          {/if}
        </ul>
      </div>

      <div class="bg-[#0d1013] px-4 py-3">
        <p
          class="font-mono text-[9px] tracking-[0.18em] text-[#6f7a6a] uppercase"
        >
          This browser
        </p>
        {#each here as device (device.id)}
          <p class="mt-1.5 font-mono text-2xl leading-none text-[#a6e22e]">
            {device.shortId}
          </p>
          <p
            class="mt-2 font-mono text-[10px] tracking-[0.14em] text-[#c7d2c1] uppercase"
          >
            {device.platform}
          </p>
        {/each}
        {#if here.length === 0}
          <p
            class="mt-1.5 font-mono text-base leading-none tracking-[0.14em] text-[#e0a33b] uppercase"
          >
            No device key
          </p>
          <p
            class="mt-2 font-mono text-[10px] tracking-[0.14em] text-[#6f7a6a] uppercase"
          >
            Nothing opens from here
          </p>
        {/if}
      </div>
    </div>

    <div class="mt-4 overflow-x-auto pb-1">
      <ul class="flex w-max min-w-full gap-2">
        {#each graph.devices as device (device.id)}
          {@const chosen = isSelected(NodeKind.Device, device.id)}
          <li class="shrink-0">
            <button
              type="button"
              aria-pressed={chosen}
              class={`w-[11rem] rounded-sm border px-3 py-2 text-left transition motion-reduce:transition-none ${
                chosen ? 'border-[#a6e22e]' : 'border-[#1b1f24]'
              } ${headTone(chosen, highlight.deviceIds.includes(device.id))}`}
              onclick={() => pick(NodeKind.Device, device.id)}
            >
              <span class="flex items-center gap-1.5">
                <Laptop
                  class="size-3.5 shrink-0 text-[#6f7a6a]"
                  aria-hidden="true"
                />
                <span class="truncate text-[12px]">{device.label}</span>
              </span>
              <span
                class="mt-1 block font-mono text-[13px] tracking-[0.1em] text-[#a6e22e]"
              >
                {device.shortId}
              </span>
              <span class="mt-0.5 flex items-baseline gap-2">
                <span
                  class="truncate font-mono text-[9px] tracking-[0.14em] text-[#6f7a6a] uppercase"
                >
                  {device.platform}
                </span>
                {#if isHere(graph, device)}
                  <span
                    class="ml-auto font-mono text-[9px] tracking-[0.14em] text-[#a6e22e] uppercase"
                  >
                    Here
                  </span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>

    <div class="mt-4 overflow-x-auto pb-2">
      <table class="w-max min-w-full border-collapse text-left">
        <caption class="sr-only">
          Passkeys by vault. Each cell names the device key that carries the
          route.
        </caption>
        <thead>
          <tr>
            <td class="border border-[#1b1f24] bg-[#0d1013] p-0">
              <div
                class="w-full min-w-[10.5rem] px-3 py-2.5 font-mono text-[9px] leading-4 tracking-[0.16em] text-[#6f7a6a] uppercase"
              >
                Passkey ↓<br />Vault →
              </div>
            </td>
            {#each graph.vaults as vault (vault.id)}
              {@const chosen = isSelected(NodeKind.Vault, vault.id)}
              <th
                scope="col"
                class="border border-[#1b1f24] bg-[#0d1013] p-0 align-top font-normal"
              >
                <button
                  type="button"
                  aria-pressed={chosen}
                  class={`block w-full min-w-[8.25rem] px-3 py-2.5 text-left transition motion-reduce:transition-none ${headTone(
                    chosen,
                    highlight.vaultIds.includes(vault.id),
                  )}`}
                  onclick={() => pick(NodeKind.Vault, vault.id)}
                >
                  <span class="flex items-center gap-1.5">
                    <VaultIcon
                      class="size-3.5 shrink-0 text-[#6f7a6a]"
                      aria-hidden="true"
                    />
                    <span class="truncate text-[12px]">{vault.label}</span>
                    {#if single(vault)}
                      <TriangleAlert
                        class="ml-auto size-3 shrink-0 text-[#e0a33b]"
                        aria-hidden="true"
                      />
                      <span class="sr-only">One passkey only</span>
                    {/if}
                  </span>
                  <span
                    class="mt-1 block font-mono text-[13px] tracking-[0.1em] text-[#a6e22e]"
                  >
                    {vault.shortId}
                  </span>
                  <span
                    class="mt-0.5 block font-mono text-[9px] tracking-[0.14em] text-[#6f7a6a] uppercase"
                  >
                    {vault.secrets} secrets
                  </span>
                  <span
                    class={`mt-1 block font-mono text-[9px] tracking-[0.14em] uppercase ${
                      openableHere(graph, vault)
                        ? 'text-[#a6e22e]'
                        : 'text-[#e0a33b]'
                    }`}
                  >
                    {openableHere(graph, vault)
                      ? 'Opens here'
                      : 'Not from here'}
                  </span>
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each graph.passkeys as passkey (passkey.id)}
            {@const chosen = isSelected(NodeKind.Passkey, passkey.id)}
            <tr>
              <th
                scope="row"
                class="border border-[#1b1f24] bg-[#0d1013] p-0 align-top font-normal"
              >
                <button
                  type="button"
                  aria-pressed={chosen}
                  class={`block w-full min-w-[10.5rem] px-3 py-2.5 text-left transition motion-reduce:transition-none ${headTone(
                    chosen,
                    highlight.passkeyIds.includes(passkey.id),
                  )}`}
                  onclick={() => pick(NodeKind.Passkey, passkey.id)}
                >
                  <span class="flex items-center gap-1.5">
                    <Fingerprint
                      class="size-3.5 shrink-0 text-[#6f7a6a]"
                      aria-hidden="true"
                    />
                    <span class="truncate text-[12px]">{passkey.label}</span>
                  </span>
                  <span
                    class="mt-1 block font-mono text-[13px] tracking-[0.1em] text-[#a6e22e]"
                  >
                    {passkey.shortId}
                  </span>
                  <span
                    class="mt-0.5 block truncate font-mono text-[9px] tracking-[0.14em] text-[#6f7a6a] uppercase"
                  >
                    {storeLabel(passkey.store)}
                  </span>
                  <span
                    class={`mt-1 block font-mono text-[9px] tracking-[0.14em] uppercase ${
                      passkey.reach === Reach.Here
                        ? 'text-[#a6e22e]'
                        : 'text-[#e0a33b]'
                    }`}
                  >
                    {passkey.reach === Reach.Here ? 'In hand' : 'Elsewhere'}
                  </span>
                </button>
              </th>

              {#each graph.vaults as vault (vault.id)}
                {@const routes = route(passkey, vault)}
                {@const lit = cellLit(passkey, vault, routes)}
                <td
                  class={`border border-[#1b1f24] p-0 align-top ${
                    routes.length === 0
                      ? 'bg-[#08090b]'
                      : lit
                        ? 'bg-[#111a0c]'
                        : 'bg-[#0b0e11]'
                  }`}
                >
                  <div
                    class={`flex w-full min-w-[8.25rem] flex-wrap items-start gap-1 px-3 py-2.5 transition motion-reduce:transition-none ${
                      routes.length === 0 || lit ? '' : 'opacity-30'
                    }`}
                  >
                    {#each routes as device (device.id)}
                      <button
                        type="button"
                        aria-pressed={isSelected(NodeKind.Device, device.id)}
                        aria-label={`Passkey ${passkey.shortId} opens vault ${vault.shortId} through device key ${device.shortId}`}
                        class={`rounded-sm border px-1.5 py-0.5 font-mono text-[11px] transition motion-reduce:transition-none ${chipTone(
                          isSelected(NodeKind.Device, device.id),
                        )}`}
                        onclick={() => pick(NodeKind.Device, device.id)}
                      >
                        {device.shortId}
                      </button>
                    {/each}
                    {#if routes.length === 0}
                      <span
                        class="font-mono text-[11px] text-[#2f353b]"
                        aria-hidden="true">·····</span
                      >
                      <span class="sr-only">
                        Passkey {passkey.shortId} does not open vault {vault.shortId}
                      </span>
                    {/if}
                  </div>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mt-4 overflow-hidden rounded-md border border-[#1b1f24]">
      <div
        class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#1b1f24] bg-[#0d1013] px-4 py-3"
      >
        <span
          class="font-mono text-[9px] tracking-[0.2em] text-[#6f7a6a] uppercase"
        >
          Selected
        </span>
        <span
          class="font-mono text-[10px] tracking-[0.16em] text-[#c7d2c1] uppercase"
        >
          {kindLabel(selected.kind)}
        </span>
        {#if chosenShortId.length > 0}
          <span class="font-mono text-base tracking-[0.12em] text-[#a6e22e]">
            {chosenShortId}
          </span>
        {/if}
      </div>
      <div class="grid gap-px bg-[#1b1f24] sm:grid-cols-3">
        {#each readout as pane (pane.label)}
          <div class="bg-[#0d1013] px-4 py-3">
            <p
              class="font-mono text-[9px] tracking-[0.18em] text-[#6f7a6a] uppercase"
            >
              {pane.label} · {pane.items.length}
            </p>
            <ul class="mt-2 flex flex-wrap gap-1">
              {#each pane.items as item (item.id)}
                <li
                  class="rounded-sm border border-[#2a3327] px-1.5 py-0.5 font-mono text-[11px] text-[#c7d2c1]"
                >
                  {item.shortId}
                </li>
              {/each}
              {#if pane.items.length === 0}
                <li
                  class="font-mono text-[10px] tracking-[0.14em] text-[#e0a33b] uppercase"
                >
                  None
                </li>
              {/if}
            </ul>
          </div>
        {/each}
      </div>
    </div>
  </section>
</main>
