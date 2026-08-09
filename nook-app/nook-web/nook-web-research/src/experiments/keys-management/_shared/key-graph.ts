/**
 * The fixture every Keys management sketch reads.
 *
 * It answers the question a person actually has in front of a locked vault:
 * *I have several passkeys scattered across several managers — which of them
 * opens this vault, and can I use it from this browser right now?*
 *
 * So this is a graph, not a chain. A passkey unlocks the device keys it is
 * enrolled on; a device key opens the vaults it is enrolled in; a passkey
 * therefore reaches a vault only through some device in between. Every node
 * carries a short identifier because comparing identifiers is the only way a
 * person can match what they see here against what a manager shows them.
 */

export enum KeyStore {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  ApplePasswords = 'apple-passwords',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Bitwarden = 'bitwarden',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  OnePassword = 'one-password',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  SecurityKey = 'security-key',
}

export function storeLabel(store: KeyStore): string {
  if (store === KeyStore.ApplePasswords) return 'Apple Passwords'
  if (store === KeyStore.Bitwarden) return 'Bitwarden'
  if (store === KeyStore.OnePassword) return '1Password'
  return 'Security key'
}

/** Whether this passkey can be presented from the browser you are looking at. */
export enum Reach {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Here = 'here',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Elsewhere = 'elsewhere',
}

export interface Passkey {
  id: string
  /** Six hex characters. Short enough to compare by eye against a manager. */
  shortId: string
  label: string
  store: KeyStore
  reach: Reach
  createdAt: string
  lastUsedAt: string
}

export interface Device {
  id: string
  shortId: string
  label: string
  platform: string
  /** Passkeys enrolled on this device key. Any one of them unlocks it. */
  passkeyIds: readonly string[]
}

export interface Vault {
  id: string
  shortId: string
  label: string
  /** Device keys enrolled in this vault. Any one of them opens it. */
  deviceIds: readonly string[]
  secrets: number
}

/** Whether the browser you are looking at holds a device key at all. */
export enum HereKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Prepared = 'prepared',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unprepared = 'unprepared',
}

export type Here =
  { kind: HereKind.Prepared; deviceId: string } | { kind: HereKind.Unprepared }

export enum GraphId {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Tangle = 'tangle',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Simple = 'simple',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Fresh = 'fresh',
}

export interface KeyGraph {
  id: GraphId
  label: string
  here: Here
  passkeys: readonly Passkey[]
  devices: readonly Device[]
  vaults: readonly Vault[]
}

/** The messy real case: three managers, three devices, four vaults. */
const tangle: KeyGraph = {
  id: GraphId.Tangle,
  label: 'Three passkeys',
  here: { kind: HereKind.Prepared, deviceId: 'dev_chrome' },
  passkeys: [
    {
      id: 'pk_apple',
      shortId: '4f2a91',
      label: 'Nook · MacBook',
      store: KeyStore.ApplePasswords,
      reach: Reach.Here,
      createdAt: '12 Mar 2026',
      lastUsedAt: '2 Aug 2026, 10:26',
    },
    {
      id: 'pk_bitwarden',
      shortId: 'c07e33',
      label: 'Nook · backup',
      store: KeyStore.Bitwarden,
      reach: Reach.Here,
      createdAt: '3 Apr 2026',
      lastUsedAt: '17 Jun 2026, 08:02',
    },
    {
      id: 'pk_work',
      shortId: '31b7d9',
      label: 'Nook · work',
      store: KeyStore.OnePassword,
      reach: Reach.Elsewhere,
      createdAt: '4 Jan 2026',
      lastUsedAt: '29 Jul 2026, 18:41',
    },
  ],
  devices: [
    {
      id: 'dev_chrome',
      shortId: '7c9dd1',
      label: 'This browser',
      platform: 'Chrome · macOS',
      passkeyIds: ['pk_apple', 'pk_bitwarden'],
    },
    {
      id: 'dev_phone',
      shortId: 'a2e650',
      label: 'iPhone',
      platform: 'Safari · iOS',
      passkeyIds: ['pk_apple'],
    },
    {
      id: 'dev_work',
      shortId: 'c4f9ea',
      label: 'Work laptop',
      platform: 'Firefox · Ubuntu',
      passkeyIds: ['pk_work'],
    },
  ],
  vaults: [
    {
      id: 'vault_personal',
      shortId: '5f0a7c',
      label: 'Personal',
      deviceIds: ['dev_chrome', 'dev_phone'],
      secrets: 34,
    },
    {
      id: 'vault_household',
      shortId: '9c3120',
      label: 'Household',
      deviceIds: ['dev_chrome'],
      secrets: 12,
    },
    {
      id: 'vault_work',
      shortId: '2ad7f1',
      label: 'Work',
      deviceIds: ['dev_work'],
      secrets: 61,
    },
    {
      id: 'vault_archive',
      shortId: 'b84e05',
      label: 'Archive 2024',
      deviceIds: ['dev_phone'],
      secrets: 8,
    },
  ],
}

/** One passkey, one browser, one vault. Nothing to disambiguate. */
const simple: KeyGraph = {
  id: GraphId.Simple,
  label: 'One passkey',
  here: { kind: HereKind.Prepared, deviceId: 'dev_chrome' },
  passkeys: [
    {
      id: 'pk_apple',
      shortId: '4f2a91',
      label: 'Nook · MacBook',
      store: KeyStore.ApplePasswords,
      reach: Reach.Here,
      createdAt: '12 Mar 2026',
      lastUsedAt: '2 Aug 2026, 10:26',
    },
  ],
  devices: [
    {
      id: 'dev_chrome',
      shortId: '7c9dd1',
      label: 'This browser',
      platform: 'Chrome · macOS',
      passkeyIds: ['pk_apple'],
    },
  ],
  vaults: [
    {
      id: 'vault_personal',
      shortId: '5f0a7c',
      label: 'Personal',
      deviceIds: ['dev_chrome'],
      secrets: 34,
    },
  ],
}

/** A browser with no device key: the passkeys exist, but not for it. */
const fresh: KeyGraph = {
  id: GraphId.Fresh,
  label: 'New browser',
  here: { kind: HereKind.Unprepared },
  passkeys: [
    {
      id: 'pk_apple',
      shortId: '4f2a91',
      label: 'Nook · MacBook',
      store: KeyStore.ApplePasswords,
      reach: Reach.Elsewhere,
      createdAt: '12 Mar 2026',
      lastUsedAt: '2 Aug 2026, 10:26',
    },
    {
      id: 'pk_work',
      shortId: '31b7d9',
      label: 'Nook · work',
      store: KeyStore.OnePassword,
      reach: Reach.Elsewhere,
      createdAt: '4 Jan 2026',
      lastUsedAt: '29 Jul 2026, 18:41',
    },
  ],
  devices: [
    {
      id: 'dev_phone',
      shortId: 'a2e650',
      label: 'iPhone',
      platform: 'Safari · iOS',
      passkeyIds: ['pk_apple'],
    },
    {
      id: 'dev_work',
      shortId: 'c4f9ea',
      label: 'Work laptop',
      platform: 'Firefox · Ubuntu',
      passkeyIds: ['pk_work'],
    },
  ],
  vaults: [
    {
      id: 'vault_personal',
      shortId: '5f0a7c',
      label: 'Personal',
      deviceIds: ['dev_phone'],
      secrets: 34,
    },
    {
      id: 'vault_work',
      shortId: '2ad7f1',
      label: 'Work',
      deviceIds: ['dev_work'],
      secrets: 61,
    },
  ],
}

export const graphs: readonly KeyGraph[] = [tangle, simple, fresh]

export function graphById(id: GraphId): KeyGraph {
  const match = graphs.find((graph) => graph.id === id)
  return match ? match : tangle
}

export function devicesForPasskey({
  graph,
  passkeyId,
}: {
  graph: KeyGraph
  passkeyId: string
}): Device[] {
  return graph.devices.filter((device) => device.passkeyIds.includes(passkeyId))
}

export function passkeysForDevice({
  graph,
  device,
}: {
  graph: KeyGraph
  device: Device
}): Passkey[] {
  return graph.passkeys.filter((passkey) =>
    device.passkeyIds.includes(passkey.id),
  )
}

export function devicesForVault({
  graph,
  vault,
}: {
  graph: KeyGraph
  vault: Vault
}): Device[] {
  return graph.devices.filter((device) => vault.deviceIds.includes(device.id))
}

export function vaultsForDevice({
  graph,
  deviceId,
}: {
  graph: KeyGraph
  deviceId: string
}): Vault[] {
  return graph.vaults.filter((vault) => vault.deviceIds.includes(deviceId))
}

/** Every vault this passkey reaches, through any device it is enrolled on. */
export function vaultsForPasskey({
  graph,
  passkeyId,
}: {
  graph: KeyGraph
  passkeyId: string
}): Vault[] {
  const nookNamedArgs0_0: Parameters<typeof devicesForPasskey>[0] = {
    graph,
    passkeyId,
  }
  const deviceIds = devicesForPasskey(nookNamedArgs0_0).map(
    (device) => device.id,
  )
  return graph.vaults.filter((vault) =>
    vault.deviceIds.some((id) => deviceIds.includes(id)),
  )
}

/** Every passkey that reaches this vault, through any device in between. */
export function passkeysForVault({
  graph,
  vault,
}: {
  graph: KeyGraph
  vault: Vault
}): Passkey[] {
  const nookNamedArgs0_1: Parameters<typeof devicesForVault>[0] = {
    graph,
    vault,
  }
  const devices = devicesForVault(nookNamedArgs0_1)
  return graph.passkeys.filter((passkey) =>
    devices.some((device) => device.passkeyIds.includes(passkey.id)),
  )
}

/** The device keys of this browser, if it has one at all. */
export function hereDevices(graph: KeyGraph): Device[] {
  if (graph.here.kind === HereKind.Unprepared) return []
  const id = graph.here.deviceId
  return graph.devices.filter((device) => device.id === id)
}

export function isHere({
  graph,
  device,
}: {
  graph: KeyGraph
  device: Device
}): boolean {
  return (
    graph.here.kind === HereKind.Prepared && graph.here.deviceId === device.id
  )
}

/** Whether this browser, as it stands, can open the vault at all. */
export function openableHere({
  graph,
  vault,
}: {
  graph: KeyGraph
  vault: Vault
}): boolean {
  return hereDevices(graph).some((device) =>
    vault.deviceIds.includes(device.id),
  )
}

/** The passkeys you could actually present from this browser right now. */
export function usableHere(graph: KeyGraph): Passkey[] {
  return graph.passkeys.filter((passkey) => passkey.reach === Reach.Here)
}

export enum NodeKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Passkey = 'passkey',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Device = 'device',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Vault = 'vault',
}

export function kindLabel(kind: NodeKind): string {
  if (kind === NodeKind.Passkey) return 'Passkey'
  return kind === NodeKind.Device ? 'Device key' : 'Vault'
}

export interface NodeRef {
  kind: NodeKind
  id: string
}

/**
 * Everything connected to one node, so a sketch can light the reachable
 * subgraph and dim the rest. Selecting a vault answers "which passkeys open
 * this?"; selecting a passkey answers "what does this one actually open?".
 */
export interface Highlight {
  passkeyIds: string[]
  deviceIds: string[]
  vaultIds: string[]
}

export function highlightFor({
  graph,
  node,
}: {
  graph: KeyGraph
  node: NodeRef
}): Highlight {
  if (node.kind === NodeKind.Passkey) {
    const nookNamedArgs0_2: Parameters<typeof devicesForPasskey>[0] = {
      graph,
      passkeyId: node.id,
    }
    const devices = devicesForPasskey(nookNamedArgs0_2)
    const nookNamedArgs0_3: Parameters<typeof vaultsForPasskey>[0] = {
      graph,
      passkeyId: node.id,
    }
    return {
      passkeyIds: [node.id],
      deviceIds: devices.map((device) => device.id),
      vaultIds: vaultsForPasskey(nookNamedArgs0_3).map((vault) => vault.id),
    }
  }
  if (node.kind === NodeKind.Device) {
    const devices = graph.devices.filter((device) => device.id === node.id)
    const nookNamedArgs0_4: Parameters<typeof vaultsForDevice>[0] = {
      graph,
      deviceId: node.id,
    }
    return {
      passkeyIds: devices.flatMap((device) => {
        const nookNamedArgument184: Parameters<typeof passkeysForDevice>[0] = {
          graph,
          device,
        }
        return passkeysForDevice(nookNamedArgument184).map(
          (passkey) => passkey.id,
        )
      }),
      deviceIds: devices.map((device) => device.id),
      vaultIds: vaultsForDevice(nookNamedArgs0_4).map((vault) => vault.id),
    }
  }
  const vaults = graph.vaults.filter((vault) => vault.id === node.id)
  const devices = vaults.flatMap((vault) => {
    const nookNamedArgument185: Parameters<typeof devicesForVault>[0] = {
      graph,
      vault,
    }
    return devicesForVault(nookNamedArgument185)
  })
  return {
    passkeyIds: vaults.flatMap((vault) => {
      const nookNamedArgument186: Parameters<typeof passkeysForVault>[0] = {
        graph,
        vault,
      }
      return passkeysForVault(nookNamedArgument186).map((passkey) => passkey.id)
    }),
    deviceIds: devices.map((device) => device.id),
    vaultIds: vaults.map((vault) => vault.id),
  }
}

/** The node a sketch should open on: this browser, or the first passkey. */
export function defaultNode(graph: KeyGraph): NodeRef {
  if (graph.here.kind === HereKind.Prepared) {
    return { kind: NodeKind.Device, id: graph.here.deviceId }
  }
  const [first] = graph.passkeys
  return first
    ? { kind: NodeKind.Passkey, id: first.id }
    : { kind: NodeKind.Vault, id: '' }
}
