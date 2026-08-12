<!--
DIRECTION: A standing index. My device key is its own block at the top of the
rail — the one object this browser can act on. Everything else I own is listed
below it, and the device keys I cannot touch sit last, as a plain quiet list.
The right side is not prose and not a graph: it is the selected identifier in
large monospace, its state, and then flat groups of identifier chips for what
it connects to.
-->
<script lang="ts">
  type IdClassArgs = { kind: NodeKind; id: string }

  type TickInkArgs = { kind: NodeKind; id: string }

  type TickClassArgs = { kind: NodeKind; id: string }

  type RowClassArgs = { kind: NodeKind; id: string }

  type MarkedArgs = { kind: NodeKind; id: string }

  type ChosenArgs = { kind: NodeKind; id: string }

  type KeyIndexSelectionRequest = { kind: NodeKind; id: string }

  type GroupsForArgs = {
    source: KeyGraph
    node: NodeRef
  }

  type VaultChipArgs = {
    source: KeyGraph
    vault: Vault
  }

  type DeviceChipArgs = {
    source: KeyGraph
    device: Device
  }

  type LabelForArgs = {
    source: KeyGraph
    node: NodeRef
  }

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
  const highlight = $derived.by(() => {
    const selectionContext: Parameters<typeof highlightFor>[0] = {
      graph,
      node: selected,
    }
    return highlightFor(selectionContext)
  })
  const others = $derived(
    graph.devices.filter((device) => {
      const nookNamedArgument204: Parameters<typeof isHere>[0] = {
        graph,
        device,
      }
      return !isHere(nookNamedArgument204)
    }),
  )
  const groups = $derived.by(() => {
    const detailContext: Parameters<typeof groupsFor>[0] = {
      source: graph,
      node: selected,
    }
    return groupsFor(detailContext)
  })
  const headerLabel = $derived.by(() => {
    const labelContext: Parameters<typeof labelFor>[0] = {
      source: graph,
      node: selected,
    }
    return labelFor(labelContext)
  })
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

  function labelFor({ source, node }: LabelForArgs): string {
    if (node.kind !== NodeKind.Device) return kindLabel(node.kind)
    const mine = source.devices.some((device) => {
      const nookNamedArgument207: Parameters<typeof isHere>[0] = {
        graph: source,
        device,
      }
      return device.id === node.id && isHere(nookNamedArgument207)
    })
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

  function deviceChip({ source, device }: DeviceChipArgs): DetailChip {
    const nookNamedArgument208: Parameters<typeof isHere>[0] = {
      graph: source,
      device,
    }
    return {
      key: `dev-${device.id}`,
      kind: NodeKind.Device,
      id: device.id,
      shortId: device.shortId,
      note: device.label,
      tint: '#7d8892',
      mark: isHere(nookNamedArgument208) ? ChipMark.Mine : ChipMark.Away,
    }
  }

  function vaultChip({ source, vault }: VaultChipArgs): DetailChip {
    const nookNamedArgument209: Parameters<typeof openableHere>[0] = {
      graph: source,
      vault,
    }
    return {
      key: `vault-${vault.id}`,
      kind: NodeKind.Vault,
      id: vault.id,
      shortId: vault.shortId,
      note: vault.label,
      tint: '#7d8892',
      mark: openableHere(nookNamedArgument209) ? ChipMark.Plain : ChipMark.Away,
    }
  }

  function groupsFor({ source, node }: GroupsForArgs): DetailGroup[] {
    if (node.kind === NodeKind.Passkey) {
      const nookNamedArgument210: Parameters<typeof devicesForPasskey>[0] = {
        graph: source,
        passkeyId: node.id,
      }
      const devices = devicesForPasskey(nookNamedArgument210)
      const nookNamedArgument215: Parameters<typeof vaultsForPasskey>[0] = {
        graph: source,
        passkeyId: node.id,
      }
      return [
        {
          key: 'mine',
          title: 'My device',
          empty: 'not enrolled here',
          chips: devices
            .filter((device) => {
              const nookNamedArgument211: Parameters<typeof isHere>[0] = {
                graph: source,
                device,
              }
              return isHere(nookNamedArgument211)
            })
            .map((device) => {
              const nookNamedArgument212: Parameters<typeof deviceChip>[0] = {
                source,
                device,
              }
              return deviceChip(nookNamedArgument212)
            }),
        },
        {
          key: 'other-devices',
          title: 'Other devices',
          empty: 'none',
          chips: devices
            .filter((device) => {
              const nookNamedArgument213: Parameters<typeof isHere>[0] = {
                graph: source,
                device,
              }
              return !isHere(nookNamedArgument213)
            })
            .map((device) => {
              const nookNamedArgument214: Parameters<typeof deviceChip>[0] = {
                source,
                device,
              }
              return deviceChip(nookNamedArgument214)
            }),
        },
        {
          key: 'vaults',
          title: 'Opens',
          empty: 'none',
          chips: vaultsForPasskey(nookNamedArgument215).map((vault) => {
            const nookNamedArgument216: Parameters<typeof vaultChip>[0] = {
              source,
              vault,
            }
            return vaultChip(nookNamedArgument216)
          }),
        },
      ]
    }

    if (node.kind === NodeKind.Device) {
      const devices = source.devices.filter((device) => device.id === node.id)
      const nookNamedArgument217: Parameters<typeof vaultsForDevice>[0] = {
        graph: source,
        deviceId: node.id,
      }
      const vaults: DetailGroup = {
        key: 'vaults',
        title: 'Opens',
        empty: 'none',
        chips: vaultsForDevice(nookNamedArgument217).map((vault) => {
          const nookNamedArgument218: Parameters<typeof vaultChip>[0] = {
            source,
            vault,
          }
          return vaultChip(nookNamedArgument218)
        }),
      }
      if (
        !devices.some((device) => {
          const nookNamedArgument219: Parameters<typeof isHere>[0] = {
            graph: source,
            device,
          }
          return isHere(nookNamedArgument219)
        })
      )
        return [vaults]
      return [
        {
          key: 'passkeys',
          title: 'Unlocked by',
          empty: 'no passkey enrolled',
          chips: devices
            .flatMap((device) => {
              const nookNamedArgument220: Parameters<
                typeof passkeysForDevice
              >[0] = { graph: source, device }
              return passkeysForDevice(nookNamedArgument220)
            })
            .map(passkeyChip),
        },
        vaults,
      ]
    }

    return source.vaults
      .filter((vault) => vault.id === node.id)
      .flatMap((vault) => {
        const nookNamedArgument221: Parameters<typeof devicesForVault>[0] = {
          graph: source,
          vault,
        }
        const devices = devicesForVault(nookNamedArgument221)
        const nookNamedArgument226: Parameters<typeof passkeysForVault>[0] = {
          graph: source,
          vault,
        }
        return [
          {
            key: 'mine',
            title: 'My device',
            empty: 'not enrolled',
            chips: devices
              .filter((device) => {
                const nookNamedArgument222: Parameters<typeof isHere>[0] = {
                  graph: source,
                  device,
                }
                return isHere(nookNamedArgument222)
              })
              .map((device) => {
                const nookNamedArgument223: Parameters<typeof deviceChip>[0] = {
                  source,
                  device,
                }
                return deviceChip(nookNamedArgument223)
              }),
          },
          {
            key: 'other-devices',
            title: 'Other devices',
            empty: 'none',
            chips: devices
              .filter((device) => {
                const nookNamedArgument224: Parameters<typeof isHere>[0] = {
                  graph: source,
                  device,
                }
                return !isHere(nookNamedArgument224)
              })
              .map((device) => {
                const nookNamedArgument225: Parameters<typeof deviceChip>[0] = {
                  source,
                  device,
                }
                return deviceChip(nookNamedArgument225)
              }),
          },
          {
            key: 'passkeys',
            title: 'Opened by',
            empty: 'none',
            chips: passkeysForVault(nookNamedArgument226).map(passkeyChip),
          },
        ]
      })
  }

  function pick({ kind, id }: KeyIndexSelectionRequest) {
    selected = { kind, id }
  }

  function chosen({ kind, id }: ChosenArgs): boolean {
    return selected.kind === kind && selected.id === id
  }

  function marked({ kind, id }: MarkedArgs): boolean {
    if (kind === NodeKind.Passkey) return highlight.passkeyIds.includes(id)
    if (kind === NodeKind.Device) return highlight.deviceIds.includes(id)
    return highlight.vaultIds.includes(id)
  }

  function rowClass({ kind, id }: RowClassArgs): string {
    const base =
      'flex w-full items-center gap-2.5 py-1.5 text-left transition duration-200 motion-reduce:transition-none'
    const nookNamedArgument227: Parameters<typeof chosen>[0] = { kind, id }
    const nookNamedArgument228: Parameters<typeof marked>[0] = { kind, id }
    if (chosen(nookNamedArgument227) || marked(nookNamedArgument228))
      return base
    return `${base} opacity-30 hover:opacity-70`
  }

  function tickClass({ kind, id }: TickClassArgs): string {
    const base = 'block w-[2px] shrink-0 rounded-full'
    const nookNamedArgument229: Parameters<typeof chosen>[0] = { kind, id }
    if (chosen(nookNamedArgument229)) return `${base} h-10`
    const nookNamedArgument230: Parameters<typeof marked>[0] = { kind, id }
    return marked(nookNamedArgument230) ? `${base} h-7` : `${base} h-4`
  }

  function tickInk({ kind, id }: TickInkArgs): string {
    const nookNamedArgument231: Parameters<typeof chosen>[0] = { kind, id }
    if (chosen(nookNamedArgument231)) return ACCENT
    const nookNamedArgument232: Parameters<typeof marked>[0] = { kind, id }
    return marked(nookNamedArgument232) ? 'rgba(240,112,58,0.5)' : '#2b3037'
  }

  function idClass({ kind, id }: IdClassArgs): string {
    const base = 'font-mono text-[13px] tracking-wide'
    const nookNamedArgument233: Parameters<typeof chosen>[0] = { kind, id }
    return chosen(nookNamedArgument233)
      ? `${base} text-[#f7f5f2]`
      : `${base} text-[#c4ccd4]`
  }

  function chipClass(chip: DetailChip): string {
    const base =
      'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition duration-200 motion-reduce:transition-none'
    const nookNamedArgument234: Parameters<typeof chosen>[0] = {
      kind: chip.kind,
      id: chip.id,
    }
    if (chosen(nookNamedArgument234)) {
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
        {@const deviceSelection: Parameters<typeof chosen>[0] = {
          kind: NodeKind.Device,
          id: device.id,
        }}
        {@const passkeyLookup: Parameters<typeof passkeysForDevice>[0] = {
          graph,
          device,
        }}
        {@const vaultLookup: Parameters<typeof vaultsForDevice>[0] = {
          graph,
          deviceId: device.id,
        }}
        <section
          class={`rounded-lg border p-3 transition duration-200 motion-reduce:transition-none ${
            chosen(deviceSelection)
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
            aria-pressed={chosen(deviceSelection)}
            aria-label={`My device key ${device.shortId}`}
            class="mt-1.5 flex items-center gap-2 font-mono text-[20px] leading-none tracking-wide text-[#f7f5f2]"
            onclick={() => pick(deviceSelection)}
          >
            <Laptop class="size-4 shrink-0" aria-hidden="true" />
            {device.shortId}
          </button>
          <p class="mt-2 text-[11px] text-[#9aa4ad]">{device.platform}</p>
          <p class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
              {passkeysForDevice(passkeyLookup).length} passkeys
            </span>
            <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
              {vaultsForDevice(vaultLookup).length} vaults
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
          {@const passkeySelection: Parameters<typeof chosen>[0] = {
            kind: NodeKind.Passkey,
            id: passkey.id,
          }}
          <li class="min-w-0">
            <button
              type="button"
              aria-pressed={chosen(passkeySelection)}
              class={rowClass(passkeySelection)}
              onclick={() => pick(passkeySelection)}
            >
              <span
                class={tickClass(passkeySelection)}
                style={`background:${tickInk(passkeySelection)}`}
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
                  <span class={idClass(passkeySelection)}>
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
              {#if marked(passkeySelection) && !chosen(passkeySelection)}
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
          {@const vaultSelection: Parameters<typeof chosen>[0] = {
            kind: NodeKind.Vault,
            id: vault.id,
          }}
          {@const vaultAvailability: Parameters<typeof openableHere>[0] = {
            graph,
            vault,
          }}
          <li class="min-w-0">
            <button
              type="button"
              aria-pressed={chosen(vaultSelection)}
              class={rowClass(vaultSelection)}
              onclick={() => pick(vaultSelection)}
            >
              <span
                class={tickClass(vaultSelection)}
                style={`background:${tickInk(vaultSelection)}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <VaultIcon
                    class="size-3 shrink-0 text-[#7d8892]"
                    aria-hidden="true"
                  />
                  <span class={idClass(vaultSelection)}>
                    {vault.shortId}
                  </span>
                  {#if openableHere(vaultAvailability)}
                    <span class="{STATE} text-[#5fd39f]">Opens here</span>
                  {:else}
                    <span class="{STATE} text-[#e0a33b]">Not here</span>
                  {/if}
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-[#7d8892]">
                  {vault.label} · {vault.secrets} secrets
                </span>
              </span>
              {#if marked(vaultSelection) && !chosen(vaultSelection)}
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
            {@const otherDeviceSelection: Parameters<typeof chosen>[0] = {
              kind: NodeKind.Device,
              id: device.id,
            }}
            <li class="min-w-0">
              <button
                type="button"
                aria-pressed={chosen(otherDeviceSelection)}
                aria-label={`Device key ${device.shortId}, ${device.label}`}
                class={`flex w-full items-center gap-2 py-1 text-left transition duration-200 motion-reduce:transition-none ${
                  chosen(otherDeviceSelection) || marked(otherDeviceSelection)
                    ? 'opacity-90'
                    : 'opacity-55 hover:opacity-80'
                }`}
                onclick={() => pick(otherDeviceSelection)}
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
        {@const pickedDeviceLocation: Parameters<typeof isHere>[0] = {
          graph,
          device,
        }}
        <p class="mt-2 font-mono text-[2rem] leading-none tracking-tight">
          {device.shortId}
        </p>
        <p class="mt-2 text-[15px] text-[#aab3bc]">{device.label}</p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
            {device.platform}
          </span>
          {#if isHere(pickedDeviceLocation)}
            <span class="{STATE} bg-[#241209] text-[#f0703a]">This browser</span
            >
          {:else}
            <span class="{STATE} bg-[#12161b] text-[#7d8892]">Read only</span>
          {/if}
        </div>
        {#if isHere(pickedDeviceLocation)}
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
        {@const pickedVaultAvailability: Parameters<typeof openableHere>[0] = {
          graph,
          vault,
        }}
        <p class="mt-2 font-mono text-[2rem] leading-none tracking-tight">
          {vault.shortId}
        </p>
        <p class="mt-2 text-[15px] text-[#aab3bc]">{vault.label}</p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="{STATE} bg-[#12161b] text-[#c4ccd4]">
            {vault.secrets} secrets
          </span>
          {#if openableHere(pickedVaultAvailability)}
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
            {@const chipSelection: Parameters<typeof chosen>[0] = {
              kind: chip.kind,
              id: chip.id,
            }}
            <li class="min-w-0">
              <button
                type="button"
                aria-pressed={chosen(chipSelection)}
                class={chipClass(chip)}
                onclick={() => pick(chipSelection)}
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
