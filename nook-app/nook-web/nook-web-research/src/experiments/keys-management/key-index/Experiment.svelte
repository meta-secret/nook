<!--
DIRECTION: A standing index. My device key is its own block at the top of the
rail — the one object this browser can act on. Everything else I own is listed
below it, and the device keys I cannot touch sit last, as a plain quiet list.
The right side is not prose and not a graph: it is the selected identifier in
large monospace, its state, and then flat groups of identifier chips for what
it connects to.
-->
<script lang="ts">
  import {
    Check,
    Fingerprint,
    Laptop,
    Vault as VaultIcon,
  } from '@lucide/svelte'
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
    kindLabel,
    KeyStore,
    NodeKind,
    type NodeRef,
    openableHere,
    type Passkey,
    passkeysForDevice,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import { ChipMark } from './chip-mark'

  /** One identifier the selected thing connects to. Drawn, never linked. */
  interface DetailChip {
    key: string
    kind: NodeKind
    id: string
    shortId: string
    note: string
    tint: string
    mark: ChipMark
  }

  interface DetailGroup {
    key: string
    title: string
    empty: string
    chips: DetailChip[]
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
  const ACTION =
    'rounded-md border border-[#2b3239] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#c4ccd4] uppercase transition duration-200 hover:border-[#f0703a] hover:text-[#f7f5f2] motion-reduce:transition-none'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
  const others = $derived(
    graph.devices.filter((device) => !isHere(graph, device)),
  )
  const groups = $derived(groupsFor(graph, selected))
  const headerLabel = $derived(labelFor(graph, selected))
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

  function labelFor(source: KeyGraph, node: NodeRef): string {
    if (node.kind !== NodeKind.Device) return kindLabel(node.kind)
    const mine = source.devices.some(
      (device) => device.id === node.id && isHere(source, device),
    )
    return mine ? 'My device' : 'Other device'
  }

  function passkeyChip(passkey: Passkey): DetailChip {
    return {
      key: `pk-${passkey.id}`,
      kind: NodeKind.Passkey,
      id: passkey.id,
      shortId: passkey.shortId,
      note: storeLabel(passkey.store),
      tint: STORE_INK[passkey.store],
      mark: passkey.reach === Reach.Here ? ChipMark.Plain : ChipMark.Away,
    }
  }

  function deviceChip(source: KeyGraph, device: Device): DetailChip {
    return {
      key: `dev-${device.id}`,
      kind: NodeKind.Device,
      id: device.id,
      shortId: device.shortId,
      note: device.label,
      tint: '#7d8892',
      mark: isHere(source, device) ? ChipMark.Mine : ChipMark.Away,
    }
  }

  function vaultChip(source: KeyGraph, vault: Vault): DetailChip {
    return {
      key: `vault-${vault.id}`,
      kind: NodeKind.Vault,
      id: vault.id,
      shortId: vault.shortId,
      note: vault.label,
      tint: '#7d8892',
      mark: openableHere(source, vault) ? ChipMark.Plain : ChipMark.Away,
    }
  }

  function groupsFor(source: KeyGraph, node: NodeRef): DetailGroup[] {
    if (node.kind === NodeKind.Passkey) {
      const devices = devicesForPasskey(source, node.id)
      return [
        {
          key: 'mine',
          title: 'My device',
          empty: 'not enrolled here',
          chips: devices
            .filter((device) => isHere(source, device))
            .map((device) => deviceChip(source, device)),
        },
        {
          key: 'other-devices',
          title: 'Other devices',
          empty: 'none',
          chips: devices
            .filter((device) => !isHere(source, device))
            .map((device) => deviceChip(source, device)),
        },
        {
          key: 'vaults',
          title: 'Opens',
          empty: 'none',
          chips: vaultsForPasskey(source, node.id).map((vault) =>
            vaultChip(source, vault),
          ),
        },
      ]
    }

    if (node.kind === NodeKind.Device) {
      const devices = source.devices.filter((device) => device.id === node.id)
      const vaults: DetailGroup = {
        key: 'vaults',
        title: 'Opens',
        empty: 'none',
        chips: vaultsForDevice(source, node.id).map((vault) =>
          vaultChip(source, vault),
        ),
      }
      if (!devices.some((device) => isHere(source, device))) return [vaults]
      return [
        {
          key: 'passkeys',
          title: 'Unlocked by',
          empty: 'no passkey enrolled',
          chips: devices
            .flatMap((device) => passkeysForDevice(source, device))
            .map(passkeyChip),
        },
        vaults,
      ]
    }

    return source.vaults
      .filter((vault) => vault.id === node.id)
      .flatMap((vault) => {
        const devices = devicesForVault(source, vault)
        return [
          {
            key: 'mine',
            title: 'My device',
            empty: 'not enrolled',
            chips: devices
              .filter((device) => isHere(source, device))
              .map((device) => deviceChip(source, device)),
          },
          {
            key: 'other-devices',
            title: 'Other devices',
            empty: 'none',
            chips: devices
              .filter((device) => !isHere(source, device))
              .map((device) => deviceChip(source, device)),
          },
          {
            key: 'passkeys',
            title: 'Opened by',
            empty: 'none',
            chips: passkeysForVault(source, vault).map(passkeyChip),
          },
        ]
      })
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

  function chipClass(chip: DetailChip): string {
    const base =
      'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition duration-200 motion-reduce:transition-none'
    if (chosen(chip.kind, chip.id)) {
      return `${base} border-[#f0703a] bg-[#20120c]`
    }
    if (chip.mark === ChipMark.Mine) {
      return `${base} border-[#f0703a]/60 bg-[#160e09] hover:border-[#f0703a]`
    }
    if (chip.mark === ChipMark.Away) {
      return `${base} border-dashed border-[#252b33] hover:border-[#454e58]`
    }
    return `${base} border-[#252b33] bg-[#0d1015] hover:border-[#454e58]`
  }
</script>

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
      {#each hereDevices(graph) as device (device.id)}
        <section
          class={`rounded-lg border p-3 transition duration-200 motion-reduce:transition-none ${
            chosen(NodeKind.Device, device.id)
              ? 'border-[#f0703a] bg-[#170e09]'
              : 'border-[#f0703a]/40 bg-[#120d0a]'
          }`}
          aria-label="My device"
        >
          <p
            class="font-mono text-[10px] tracking-[0.2em] uppercase"
            style={`color:${ACCENT}`}
          >
            My device
          </p>
          <button
            type="button"
            aria-pressed={chosen(NodeKind.Device, device.id)}
            aria-label={`My device key ${device.shortId}`}
            class="mt-1.5 flex items-center gap-2 font-mono text-[20px] leading-none tracking-wide text-[#f7f5f2]"
            onclick={() => pick(NodeKind.Device, device.id)}
          >
            <Laptop class="size-4 shrink-0" aria-hidden="true" />
            {device.shortId}
          </button>
          <p class="mt-2 text-[11px] text-[#9aa4ad]">{device.platform}</p>
          <p class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
              {passkeysForDevice(graph, device).length} passkeys
            </span>
            <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
              {vaultsForDevice(graph, device.id).length} vaults
            </span>
          </p>
        </section>
      {/each}

      {#if graph.here.kind === HereKind.Unprepared}
        <section
          class="rounded-lg border border-dashed border-[#5a4326] bg-[#120e09] p-3"
          aria-label="My device"
        >
          <p
            class="font-mono text-[10px] tracking-[0.2em] uppercase"
            style={`color:${ACCENT}`}
          >
            My device
          </p>
          <p class="mt-1.5 font-mono text-[18px] text-[#e0a33b]">
            no device key
          </p>
          <button type="button" class="{ACTION} mt-3">
            set up this browser
          </button>
        </section>
      {/if}

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

      {#if others.length > 0}
        <p class="mt-6 {GROUP}">
          <span>Other devices</span><span>×{others.length}</span>
        </p>
        <ul class="mt-1 border-t border-[#14171c]">
          {#each others as device (device.id)}
            <li class="min-w-0">
              <button
                type="button"
                aria-pressed={chosen(NodeKind.Device, device.id)}
                aria-label={`Device key ${device.shortId}, ${device.label}`}
                class={`flex w-full items-center gap-2 py-1 text-left transition duration-200 motion-reduce:transition-none ${
                  chosen(NodeKind.Device, device.id) ||
                  marked(NodeKind.Device, device.id)
                    ? 'opacity-90'
                    : 'opacity-55 hover:opacity-80'
                }`}
                onclick={() => pick(NodeKind.Device, device.id)}
              >
                <span class="font-mono text-[12px] text-[#9aa4ad]">
                  {device.shortId}
                </span>
                <span class="truncate text-[11px] text-[#6b747e]">
                  {device.label}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </nav>

    <section class="min-w-0">
      <p
        class="font-mono text-[10px] tracking-[0.24em] uppercase"
        style={`color:${ACCENT}`}
      >
        {headerLabel}
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
            <span class="{STATE} bg-[#241209] text-[#f0703a]">This browser</span
            >
          {:else}
            <span class="{STATE} bg-[#12161b] text-[#7d8892]">Read only</span>
          {/if}
        </div>
        {#if isHere(graph, device)}
          <div class="mt-4 flex flex-wrap items-center gap-1.5">
            <button type="button" class={ACTION}>rename</button>
            <button type="button" class={ACTION}>enrol passkey</button>
            <button
              type="button"
              class="{ACTION} border-[#4a2a22] text-[#e08a6a] hover:border-[#e0664a]"
            >
              revoke
            </button>
          </div>
        {/if}
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

      {#each groups as group (group.key)}
        <p class="mt-7 {GROUP} max-w-xl">
          <span>{group.title}</span><span>×{group.chips.length}</span>
        </p>
        <ul class="mt-2 flex max-w-xl flex-wrap gap-1.5">
          {#each group.chips as chip (chip.key)}
            <li class="min-w-0">
              <button
                type="button"
                aria-pressed={chosen(chip.kind, chip.id)}
                class={chipClass(chip)}
                onclick={() => pick(chip.kind, chip.id)}
              >
                {#if chip.kind === NodeKind.Passkey}
                  <span
                    class="size-2 shrink-0 rounded-full"
                    style={`background:${chip.tint}`}
                    aria-hidden="true"
                  ></span>
                {:else if chip.kind === NodeKind.Device}
                  <Laptop
                    class="size-3 shrink-0 text-[#7d8892]"
                    aria-hidden="true"
                  />
                {:else}
                  <VaultIcon
                    class="size-3 shrink-0 text-[#7d8892]"
                    aria-hidden="true"
                  />
                {/if}
                <span class="font-mono text-[13px] text-[#e6eaee]">
                  {chip.shortId}
                </span>
                <span class="max-w-[8rem] truncate text-[10px] text-[#7d8892]">
                  {chip.note}
                </span>
              </button>
            </li>
          {:else}
            <li
              class="{STATE} border border-dashed border-[#22272e] text-[#6b747e]"
            >
              {group.empty}
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  </div>
</main>
