<!--
DIRECTION: A standing index. The left rail is permanent and lists every
passkey, device key and vault you own, each with its identifier and its state.
Selecting anything marks, in the rail itself, everything it reaches. The right
side is not prose: it is the selected identifier, then every route through the
graph drawn as a chain of linked identifier chips.
-->
<script lang="ts">
  import {
    Check,
    ChevronRight,
    Fingerprint,
    Laptop,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    type Device,
    GraphId,
    graphById,
    HereKind,
    hereDevices,
    highlightFor,
    isHere,
    type KeyGraph,
    kindLabel,
    KeyStore,
    NodeKind,
    type NodeRef,
    openableHere,
    type Passkey,
    passkeysForDevice,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  /** One passkey → device key → vault path. The unit the right panel draws. */
  interface Route {
    id: string
    passkey: Passkey
    device: Device
    vault: Vault
    here: boolean
  }

  interface ChainNode {
    kind: NodeKind
    id: string
    shortId: string
    label: string
    tint: string
  }

  const ACCENT = '#f0703a'
  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#b9c4cf',
    [KeyStore.Bitwarden]: '#5b8cff',
    [KeyStore.OnePassword]: '#37c493',
    [KeyStore.SecurityKey]: '#e6ad48',
  }

  const GROUP =
    'flex items-baseline justify-between font-mono text-[10px] tracking-[0.2em] text-[#6b747e] uppercase'
  const STATE =
    'rounded px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const routes = $derived(
    allRoutes(graph).filter(
      (route) =>
        highlight.passkeyIds.includes(route.passkey.id) &&
        highlight.deviceIds.includes(route.device.id) &&
        highlight.vaultIds.includes(route.vault.id),
    ),
  )
  const pickedPasskeys = $derived(
    graph.passkeys.filter(
      (passkey) =>
        selected.kind === NodeKind.Passkey && passkey.id === selected.id,
    ),
  )
  const pickedDevices = $derived(
    graph.devices.filter(
      (device) =>
        selected.kind === NodeKind.Device && device.id === selected.id,
    ),
  )
  const pickedVaults = $derived(
    graph.vaults.filter(
      (vault) => selected.kind === NodeKind.Vault && vault.id === selected.id,
    ),
  )

  function allRoutes(source: KeyGraph): Route[] {
    return source.devices.flatMap((device) =>
      passkeysForDevice(source, device).flatMap((passkey) =>
        vaultsForDevice(source, device.id).map((vault) => ({
          id: `${passkey.id}|${device.id}|${vault.id}`,
          passkey,
          device,
          vault,
          here: passkey.reach === Reach.Here && isHere(source, device),
        })),
      ),
    )
  }

  function chainNodes(route: Route): ChainNode[] {
    return [
      {
        kind: NodeKind.Passkey,
        id: route.passkey.id,
        shortId: route.passkey.shortId,
        label: storeLabel(route.passkey.store),
        tint: STORE_INK[route.passkey.store],
      },
      {
        kind: NodeKind.Device,
        id: route.device.id,
        shortId: route.device.shortId,
        label: route.device.label,
        tint: '#7d8892',
      },
      {
        kind: NodeKind.Vault,
        id: route.vault.id,
        shortId: route.vault.shortId,
        label: route.vault.label,
        tint: '#7d8892',
      },
    ]
  }

  function pick(kind: NodeKind, id: string) {
    selected = { kind, id }
  }

  function chosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function marked(kind: NodeKind, id: string): boolean {
    if (kind === NodeKind.Passkey) return highlight.passkeyIds.includes(id)
    if (kind === NodeKind.Device) return highlight.deviceIds.includes(id)
    return highlight.vaultIds.includes(id)
  }

  function rowClass(kind: NodeKind, id: string): string {
    const base =
      'flex w-full items-center gap-2.5 py-1.5 text-left transition duration-200 motion-reduce:transition-none'
    if (chosen(kind, id) || marked(kind, id)) return base
    return `${base} opacity-30 hover:opacity-70`
  }

  function tickClass(kind: NodeKind, id: string): string {
    const base = 'block w-[2px] shrink-0 rounded-full'
    if (chosen(kind, id)) return `${base} h-10`
    return marked(kind, id) ? `${base} h-7` : `${base} h-4`
  }

  function tickInk(kind: NodeKind, id: string): string {
    if (chosen(kind, id)) return ACCENT
    return marked(kind, id) ? 'rgba(240,112,58,0.5)' : '#2b3037'
  }

  function idClass(kind: NodeKind, id: string): string {
    const base = 'font-mono text-[13px] tracking-wide'
    return chosen(kind, id)
      ? `${base} text-[#f7f5f2]`
      : `${base} text-[#c4ccd4]`
  }

  function chipClass(node: ChainNode): string {
    const base =
      'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition duration-200 motion-reduce:transition-none'
    return chosen(node.kind, node.id)
      ? `${base} border-[#f0703a] bg-[#20120c]`
      : `${base} border-[#252b33] bg-[#0d1015] hover:border-[#454e58]`
  }
</script>

{#snippet chainChip(node: ChainNode)}
  <button
    type="button"
    aria-pressed={chosen(node.kind, node.id)}
    class={chipClass(node)}
    onclick={() => pick(node.kind, node.id)}
  >
    {#if node.kind === NodeKind.Passkey}
      <span
        class="size-2 shrink-0 rounded-full"
        style={`background:${node.tint}`}
        aria-hidden="true"
      ></span>
    {:else if node.kind === NodeKind.Device}
      <Laptop class="size-3 shrink-0 text-[#7d8892]" aria-hidden="true" />
    {:else}
      <VaultIcon class="size-3 shrink-0 text-[#7d8892]" aria-hidden="true" />
    {/if}
    <span class="font-mono text-[12px] text-[#e6eaee]">{node.shortId}</span>
    <span
      class="hidden max-w-[7rem] truncate text-[10px] text-[#7d8892] sm:block"
    >
      {node.label}
    </span>
  </button>
{/snippet}

<main class="min-h-[100svh] bg-[#08090b] text-[#e6eaee]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
    }}
  />

  <div
    class="mx-auto grid max-w-6xl gap-8 px-4 pt-28 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10"
  >
    <nav
      class="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto lg:pr-2"
      aria-label="Key index"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        {#each hereDevices(graph) as device (device.id)}
          <span class="{STATE} bg-[#132119] text-[#5fd39f]">
            This browser · {device.shortId}
          </span>
        {/each}
        {#if graph.here.kind === HereKind.Unprepared}
          <span class="{STATE} bg-[#241a12] text-[#e0a33b]">
            This browser · no device key
          </span>
        {/if}
      </div>

      <p class="mt-6 {GROUP}">
        <span>Passkeys</span><span>×{graph.passkeys.length}</span>
      </p>
      <ul
        class="mt-1 grid border-t border-[#1a1e24] sm:grid-cols-2 lg:grid-cols-1"
      >
        {#each graph.passkeys as passkey (passkey.id)}
          <li class="min-w-0">
            <button
              type="button"
              aria-pressed={chosen(NodeKind.Passkey, passkey.id)}
              class={rowClass(NodeKind.Passkey, passkey.id)}
              onclick={() => pick(NodeKind.Passkey, passkey.id)}
            >
              <span
                class={tickClass(NodeKind.Passkey, passkey.id)}
                style={`background:${tickInk(NodeKind.Passkey, passkey.id)}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span
                    class="flex shrink-0"
                    style={`color:${STORE_INK[passkey.store]}`}
                    aria-hidden="true"
                  >
                    <Fingerprint class="size-3" />
                  </span>
                  <span class={idClass(NodeKind.Passkey, passkey.id)}>
                    {passkey.shortId}
                  </span>
                  {#if passkey.reach === Reach.Here}
                    <span class="{STATE} text-[#5fd39f]">Here</span>
                  {:else}
                    <span class="{STATE} text-[#6b747e]">Elsewhere</span>
                  {/if}
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-[#7d8892]">
                  {storeLabel(passkey.store)} · {passkey.label}
                </span>
              </span>
              {#if marked(NodeKind.Passkey, passkey.id) && !chosen(NodeKind.Passkey, passkey.id)}
                <span
                  class="flex shrink-0"
                  style={`color:${ACCENT}`}
                  aria-hidden="true"
                >
                  <Check class="size-3.5" />
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      <p class="mt-6 {GROUP}">
        <span>Device keys</span><span>×{graph.devices.length}</span>
      </p>
      <ul
        class="mt-1 grid border-t border-[#1a1e24] sm:grid-cols-2 lg:grid-cols-1"
      >
        {#each graph.devices as device (device.id)}
          <li class="min-w-0">
            <button
              type="button"
              aria-pressed={chosen(NodeKind.Device, device.id)}
              class={rowClass(NodeKind.Device, device.id)}
              onclick={() => pick(NodeKind.Device, device.id)}
            >
              <span
                class={tickClass(NodeKind.Device, device.id)}
                style={`background:${tickInk(NodeKind.Device, device.id)}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <Laptop
                    class="size-3 shrink-0 text-[#7d8892]"
                    aria-hidden="true"
                  />
                  <span class={idClass(NodeKind.Device, device.id)}>
                    {device.shortId}
                  </span>
                  {#if isHere(graph, device)}
                    <span class="{STATE} text-[#5fd39f]">Here</span>
                  {/if}
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-[#7d8892]">
                  {device.label} · {device.platform}
                </span>
              </span>
              {#if marked(NodeKind.Device, device.id) && !chosen(NodeKind.Device, device.id)}
                <span
                  class="flex shrink-0"
                  style={`color:${ACCENT}`}
                  aria-hidden="true"
                >
                  <Check class="size-3.5" />
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      <p class="mt-6 {GROUP}">
        <span>Vaults</span><span>×{graph.vaults.length}</span>
      </p>
      <ul
        class="mt-1 grid border-t border-[#1a1e24] sm:grid-cols-2 lg:grid-cols-1"
      >
        {#each graph.vaults as vault (vault.id)}
          <li class="min-w-0">
            <button
              type="button"
              aria-pressed={chosen(NodeKind.Vault, vault.id)}
              class={rowClass(NodeKind.Vault, vault.id)}
              onclick={() => pick(NodeKind.Vault, vault.id)}
            >
              <span
                class={tickClass(NodeKind.Vault, vault.id)}
                style={`background:${tickInk(NodeKind.Vault, vault.id)}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <VaultIcon
                    class="size-3 shrink-0 text-[#7d8892]"
                    aria-hidden="true"
                  />
                  <span class={idClass(NodeKind.Vault, vault.id)}>
                    {vault.shortId}
                  </span>
                  {#if openableHere(graph, vault)}
                    <span class="{STATE} text-[#5fd39f]">Opens here</span>
                  {:else}
                    <span class="{STATE} text-[#e0a33b]">Not here</span>
                  {/if}
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-[#7d8892]">
                  {vault.label} · {vault.secrets} secrets
                </span>
              </span>
              {#if marked(NodeKind.Vault, vault.id) && !chosen(NodeKind.Vault, vault.id)}
                <span
                  class="flex shrink-0"
                  style={`color:${ACCENT}`}
                  aria-hidden="true"
                >
                  <Check class="size-3.5" />
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </nav>

    <section class="min-w-0">
      <p
        class="font-mono text-[10px] tracking-[0.24em] uppercase"
        style={`color:${ACCENT}`}
      >
        {kindLabel(selected.kind)}
      </p>

      {#each pickedPasskeys as passkey (passkey.id)}
        <p class="mt-2 font-mono text-[2rem] leading-none tracking-tight">
          {passkey.shortId}
        </p>
        <p class="mt-2 text-[15px] text-[#aab3bc]">{passkey.label}</p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            class="flex items-center gap-1.5 {STATE} bg-[#12161b] text-[#c4ccd4]"
          >
            <span
              class="size-2 rounded-full"
              style={`background:${STORE_INK[passkey.store]}`}
              aria-hidden="true"
            ></span>
            {storeLabel(passkey.store)}
          </span>
          {#if passkey.reach === Reach.Here}
            <span class="{STATE} bg-[#132119] text-[#5fd39f]">Usable here</span>
          {:else}
            <span class="{STATE} bg-[#241a12] text-[#e0a33b]">
              Not on this browser
            </span>
          {/if}
          <span class="{STATE} bg-[#12161b] text-[#7d8892]">
            Made {passkey.createdAt}
          </span>
          <span class="{STATE} bg-[#12161b] text-[#7d8892]">
            Used {passkey.lastUsedAt}
          </span>
        </div>
      {/each}

      {#each pickedDevices as device (device.id)}
        <p class="mt-2 font-mono text-[2rem] leading-none tracking-tight">
          {device.shortId}
        </p>
        <p class="mt-2 text-[15px] text-[#aab3bc]">{device.label}</p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
            {device.platform}
          </span>
          {#if isHere(graph, device)}
            <span class="{STATE} bg-[#132119] text-[#5fd39f]">This browser</span
            >
          {:else}
            <span class="{STATE} bg-[#12161b] text-[#7d8892]"
              >Another browser</span
            >
          {/if}
        </div>
      {/each}

      {#each pickedVaults as vault (vault.id)}
        <p class="mt-2 font-mono text-[2rem] leading-none tracking-tight">
          {vault.shortId}
        </p>
        <p class="mt-2 text-[15px] text-[#aab3bc]">{vault.label}</p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
            {vault.secrets} secrets
          </span>
          {#if openableHere(graph, vault)}
            <span class="{STATE} bg-[#132119] text-[#5fd39f]">Opens here</span>
          {:else}
            <span class="{STATE} bg-[#241a12] text-[#e0a33b]">
              Not from this browser
            </span>
          {/if}
        </div>
      {/each}

      <p class="mt-8 {GROUP} max-w-xl">
        <span>Routes</span><span>×{routes.length}</span>
      </p>
      <ul class="mt-2 max-w-xl space-y-2">
        {#each routes as route (route.id)}
          <li
            class={`flex items-stretch gap-3 rounded-lg border px-3 py-2.5 ${
              route.here
                ? 'border-[#2b3239] bg-[#0c1015]'
                : 'border-dashed border-[#22272e] bg-[#0a0c0f]'
            }`}
          >
            <span
              class="block w-[2px] shrink-0 rounded-full"
              style={`background:${route.here ? '#5fd39f' : '#3a424c'}`}
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                {#each chainNodes(route) as node, index (node.id)}
                  {#if index > 0}
                    <ChevronRight
                      class="size-3.5 shrink-0 text-[#454e58]"
                      aria-hidden="true"
                    />
                  {/if}
                  {@render chainChip(node)}
                {/each}
              </span>
              <span
                class="mt-1.5 block font-mono text-[9px] tracking-[0.16em] uppercase"
                style={`color:${route.here ? '#5fd39f' : '#6b747e'}`}
              >
                {route.here ? 'Usable here' : 'Not from this browser'}
              </span>
            </span>
          </li>
        {:else}
          <li
            class="rounded-lg border border-dashed border-[#2b2118] px-3 py-3 font-mono text-[10px] tracking-[0.16em] text-[#e0a33b] uppercase"
          >
            No route
          </li>
        {/each}
      </ul>
    </section>
  </div>
</main>
