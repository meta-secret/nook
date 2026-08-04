export enum IdentityKind {
  Personal = 'personal',
  Collective = 'collective',
}

export enum DevicePresence {
  Here = 'here',
  Elsewhere = 'elsewhere',
}

export enum PasskeyMobility {
  Synced = 'synced',
  DeviceBound = 'device-bound',
}

export enum AccessAvailability {
  Here = 'here',
  Elsewhere = 'elsewhere',
  Unknown = 'unknown',
}

export enum ProviderMountState {
  CurrentDevice = 'current-device',
}

export enum IdentityReplicationKind {
  LocalOnly = 'local-only',
  Mounted = 'mounted',
}

export enum VaultGrantStatus {
  Active = 'active',
}

export enum SelectionKind {
  None = 'none',
  Identity = 'identity',
  DeviceKey = 'device-key',
  Passkey = 'passkey',
  Vault = 'vault',
}

export type Selection =
  | { kind: SelectionKind.None }
  | { kind: SelectionKind.Identity; id: string }
  | { kind: SelectionKind.DeviceKey; id: string }
  | { kind: SelectionKind.Passkey; id: string }
  | { kind: SelectionKind.Vault; id: string }

export type IdentityAccount = {
  id: string
  label: string
  shortId: string
  kind: IdentityKind
  role: string
  deviceKeyIds: readonly string[]
  replication:
    | { kind: IdentityReplicationKind.LocalOnly }
    | {
        kind: IdentityReplicationKind.Mounted
        providerMountIds: readonly string[]
      }
  vaultGrantIds: readonly string[]
}

export type PhysicalDevice = {
  id: string
  label: string
  platform: string
  presence: DevicePresence
}

export type DeviceKey = {
  id: string
  shortId: string
  publicKey: string
  deviceId: string
  addedAt: string
}

export type PasskeyAccessMethod = {
  id: string
  shortId: string
  providerLabel: string
  mobility: PasskeyMobility
  availability: AccessAvailability
  evidence: string
  protectsDeviceKeyIds: readonly string[]
}

export type ProviderMount = {
  id: string
  provider: string
  accountLabel: string
  target: string
  state: ProviderMountState
}

export type VaultGrant = {
  id: string
  identityId: string
  vaultId: string
  vaultLabel: string
  capability: string
  status: VaultGrantStatus
}

export const identities: readonly IdentityAccount[] = [
  {
    id: 'identity-nora',
    label: 'Nora',
    shortId: 'idn_7c9d',
    kind: IdentityKind.Personal,
    role: 'Owner',
    deviceKeyIds: ['device-key-mac-personal', 'device-key-phone-personal'],
    replication: {
      kind: IdentityReplicationKind.Mounted,
      providerMountIds: ['mount-nora-drive'],
    },
    vaultGrantIds: ['grant-personal-owner', 'grant-studio-nora-member'],
  },
  {
    id: 'identity-studio',
    label: 'Northstar studio',
    shortId: 'idn_a2e6',
    kind: IdentityKind.Collective,
    role: 'Member · 3 people',
    deviceKeyIds: ['device-key-mac-studio', 'device-key-workstation'],
    replication: {
      kind: IdentityReplicationKind.Mounted,
      providerMountIds: ['mount-studio-drive'],
    },
    vaultGrantIds: ['grant-studio-collective-member'],
  },
  {
    id: 'identity-field-notes',
    label: 'Field notes',
    shortId: 'idn_f014',
    kind: IdentityKind.Personal,
    role: 'Owner · setup incomplete',
    deviceKeyIds: [],
    replication: { kind: IdentityReplicationKind.LocalOnly },
    vaultGrantIds: [],
  },
]

export const physicalDevices: readonly PhysicalDevice[] = [
  {
    id: 'device-mac',
    label: 'Nora’s MacBook',
    platform: 'macOS · Chrome · this browser',
    presence: DevicePresence.Here,
  },
  {
    id: 'device-phone',
    label: 'Nora’s iPhone',
    platform: 'iOS · Safari · last seen yesterday',
    presence: DevicePresence.Elsewhere,
  },
  {
    id: 'device-workstation',
    label: 'Studio workstation',
    platform: 'Linux · Firefox · last seen 3 days ago',
    presence: DevicePresence.Elsewhere,
  },
]

export const deviceKeys: readonly DeviceKey[] = [
  {
    id: 'device-key-mac-personal',
    shortId: 'dev_72c1',
    publicKey: 'age1q8…6m4k',
    deviceId: 'device-mac',
    addedAt: 'Added 18 Jun',
  },
  {
    id: 'device-key-phone-personal',
    shortId: 'dev_b091',
    publicKey: 'age1kp…8zc2',
    deviceId: 'device-phone',
    addedAt: 'Added 22 Jun',
  },
  {
    id: 'device-key-mac-studio',
    shortId: 'dev_339a',
    publicKey: 'age1m2…q7ad',
    deviceId: 'device-mac',
    addedAt: 'Added 02 Jul',
  },
  {
    id: 'device-key-workstation',
    shortId: 'dev_10ef',
    publicKey: 'age1vr…2xk8',
    deviceId: 'device-workstation',
    addedAt: 'Added 02 Jul',
  },
]

export const passkeys: readonly PasskeyAccessMethod[] = [
  {
    id: 'passkey-apple',
    shortId: 'pk_c07e',
    providerLabel: 'User-named Apple Passwords',
    mobility: PasskeyMobility.Synced,
    availability: AccessAvailability.Here,
    evidence: 'BE=1 · backed up · available here through the passkey provider',
    protectsDeviceKeyIds: [
      'device-key-mac-personal',
      'device-key-phone-personal',
    ],
  },
  {
    id: 'passkey-bitwarden',
    shortId: 'pk_88d2',
    providerLabel: 'User-named Bitwarden',
    mobility: PasskeyMobility.Synced,
    availability: AccessAvailability.Here,
    evidence: 'BE=1 · backed up · provider availability, not device location',
    protectsDeviceKeyIds: ['device-key-mac-studio'],
  },
  {
    id: 'passkey-security-key',
    shortId: 'pk_f311',
    providerLabel: 'Hardware security key',
    mobility: PasskeyMobility.DeviceBound,
    availability: AccessAvailability.Elsewhere,
    evidence: 'BE=0 · single-device credential · present when the key is connected',
    protectsDeviceKeyIds: ['device-key-workstation'],
  },
]

export const providerMounts: readonly ProviderMount[] = [
  {
    id: 'mount-nora-drive',
    provider: 'Google Drive',
    accountLabel: 'nora@example.com',
    target: 'Nora identity control log',
    state: ProviderMountState.CurrentDevice,
  },
  {
    id: 'mount-studio-drive',
    provider: 'Google Drive',
    accountLabel: 'northstar@example.com',
    target: 'Northstar identity control log',
    state: ProviderMountState.CurrentDevice,
  },
]

export const vaultGrants: readonly VaultGrant[] = [
  {
    id: 'grant-personal-owner',
    identityId: 'identity-nora',
    vaultId: 'store_79c1',
    vaultLabel: 'Personal',
    capability: 'owner',
    status: VaultGrantStatus.Active,
  },
  {
    id: 'grant-studio-nora-member',
    identityId: 'identity-nora',
    vaultId: 'store_2ae6',
    vaultLabel: 'Northstar studio',
    capability: 'member',
    status: VaultGrantStatus.Active,
  },
  {
    id: 'grant-studio-collective-member',
    identityId: 'identity-studio',
    vaultId: 'store_2ae6',
    vaultLabel: 'Northstar studio',
    capability: 'member',
    status: VaultGrantStatus.Active,
  },
]

export function identityById(id: string): IdentityAccount {
  const match = identities.find((identity) => identity.id === id)
  if (match) return match
  throw new Error(`Unknown identity fixture: ${id}`)
}

export function deviceById(id: string): PhysicalDevice {
  const match = physicalDevices.find((device) => device.id === id)
  if (match) return match
  throw new Error(`Unknown physical device fixture: ${id}`)
}

export function deviceKeyById(id: string): DeviceKey {
  const match = deviceKeys.find((deviceKey) => deviceKey.id === id)
  if (match) return match
  throw new Error(`Unknown device key fixture: ${id}`)
}

export function providerMountById(id: string): ProviderMount {
  const match = providerMounts.find((mount) => mount.id === id)
  if (match) return match
  throw new Error(`Unknown provider mount fixture: ${id}`)
}

export function vaultGrantById(id: string): VaultGrant {
  const match = vaultGrants.find((grant) => grant.id === id)
  if (match) return match
  throw new Error(`Unknown vault grant fixture: ${id}`)
}

export function deviceKeysForIdentity(
  identity: IdentityAccount,
): readonly DeviceKey[] {
  return identity.deviceKeyIds.map(deviceKeyById)
}

export function devicesForIdentity(
  identity: IdentityAccount,
): readonly PhysicalDevice[] {
  const deviceIds = new Set(
    deviceKeysForIdentity(identity).map((deviceKey) => deviceKey.deviceId),
  )
  return physicalDevices.filter((device) => deviceIds.has(device.id))
}

export function deviceKeysForPhysicalDevice(
  identity: IdentityAccount,
  deviceId: string,
): readonly DeviceKey[] {
  return deviceKeysForIdentity(identity).filter(
    (deviceKey) => deviceKey.deviceId === deviceId,
  )
}

export function passkeysForIdentity(
  identity: IdentityAccount,
): readonly PasskeyAccessMethod[] {
  return passkeys.filter((passkey) =>
    passkey.protectsDeviceKeyIds.some((deviceKeyId) =>
      identity.deviceKeyIds.includes(deviceKeyId),
    ),
  )
}

export function passkeysForDeviceKey(
  deviceKeyId: string,
): readonly PasskeyAccessMethod[] {
  return passkeys.filter((passkey) =>
    passkey.protectsDeviceKeyIds.includes(deviceKeyId),
  )
}
