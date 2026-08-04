export enum IdentityStatus {
  Active = 'active',
  Verified = 'verified',
  Degraded = 'degraded',
  Pending = 'pending',
}

export enum DeviceType {
  Workstation = 'workstation',
  SecurityKey = 'security_key',
  MobileEnclave = 'mobile_enclave',
  HardwareSigner = 'hardware_signer',
}

export enum KeyType {
  DeviceX25519 = 'device_x25519',
  SigningEd25519 = 'signing_ed25519',
  PasskeyPrfSeed = 'passkey_prf_seed',
  PivSlot = 'piv_slot',
  AgeRecipient = 'age_recipient',
}

export enum VaultRole {
  Owner = 'owner',
  FullSigner = 'full_signer',
  ThresholdParticipant = 'threshold_participant',
  RecoveryGuardian = 'recovery_guardian',
  ReadOnlyObserver = 'read_only_observer',
}

export enum VaultPolicyType {
  SingleOwner = 'single_owner',
  ThresholdQuorum = 'threshold_quorum',
  MultisigRecovery = 'multisig_recovery',
}

export interface KeyItem {
  id: string
  name: string
  keyType: KeyType
  fingerprint: string
  algorithm: string
  createdIso: string
  usageCount: number
  isHardwareBacked: boolean
}

export interface DeviceItem {
  id: string
  name: string
  deviceType: DeviceType
  os: string
  lastActiveIso: string
  trustScore: number
  keys: KeyItem[]
}

export interface IdentityItem {
  id: string
  name: string
  handle: string
  avatarColor: string
  status: IdentityStatus
  createdIso: string
  devices: DeviceItem[]
  chainStrengthScore: number
}

export interface VaultItem {
  id: string
  name: string
  description: string
  policyType: VaultPolicyType
  thresholdK: number
  totalN: number
  itemCount: number
  lastSyncedIso: string
  associatedIdentityIds: string[]
  identityRoles: Record<string, VaultRole>
}

export const MOCK_IDENTITIES: IdentityItem[] = [
  {
    id: 'id-main',
    name: 'Main Identity (Alex Vance)',
    handle: '@alex.vance',
    avatarColor: 'from-emerald-500 to-teal-700',
    status: IdentityStatus.Verified,
    createdIso: '2025-01-15T09:30:00Z',
    chainStrengthScore: 98,
    devices: [
      {
        id: 'dev-macbook',
        name: 'MacBook Pro M3 Max',
        deviceType: DeviceType.Workstation,
        os: 'macOS Sequoia 15.2',
        lastActiveIso: '2026-08-03T21:40:00Z',
        trustScore: 99,
        keys: [
          {
            id: 'key-x25519-mac',
            name: 'Device X25519 Root',
            keyType: KeyType.DeviceX25519,
            fingerprint: 'fp_x25519_9a8b7c6d5e4f3a2b',
            algorithm: 'X25519 Curve25519',
            createdIso: '2025-01-15T09:35:00Z',
            usageCount: 1420,
            isHardwareBacked: true,
          },
          {
            id: 'key-prf-mac',
            name: 'WebAuthn PRF Master Seed',
            keyType: KeyType.PasskeyPrfSeed,
            fingerprint: 'fp_prf_7f8e9d0c1b2a3f4e',
            algorithm: 'HKDF-SHA256 / Passkey PRF',
            createdIso: '2025-01-15T09:36:00Z',
            usageCount: 850,
            isHardwareBacked: true,
          },
        ],
      },
      {
        id: 'dev-yubikey-primary',
        name: 'YubiKey 5C NFC (Primary)',
        deviceType: DeviceType.SecurityKey,
        os: 'YubiKey Firmware 5.7.1',
        lastActiveIso: '2026-08-03T20:15:00Z',
        trustScore: 100,
        keys: [
          {
            id: 'key-piv-yubikey',
            name: 'PIV Slot 9a (Authentication)',
            keyType: KeyType.PivSlot,
            fingerprint: 'fp_piv_1a2b3c4d5e6f7a8b',
            algorithm: 'RSA-4096 / PIV',
            createdIso: '2025-01-16T14:10:00Z',
            usageCount: 310,
            isHardwareBacked: true,
          },
          {
            id: 'key-ed25519-yubikey',
            name: 'Ed25519 Signing Key',
            keyType: KeyType.SigningEd25519,
            fingerprint: 'fp_ed25519_3c4d5e6f7a8b9c0d',
            algorithm: 'Ed25519',
            createdIso: '2025-01-16T14:12:00Z',
            usageCount: 640,
            isHardwareBacked: true,
          },
        ],
      },
      {
        id: 'dev-iphone',
        name: 'iPhone 15 Pro (Secure Enclave)',
        deviceType: DeviceType.MobileEnclave,
        os: 'iOS 18.3',
        lastActiveIso: '2026-08-03T19:50:00Z',
        trustScore: 95,
        keys: [
          {
            id: 'key-age-iphone',
            name: 'Age Recipient Identity',
            keyType: KeyType.AgeRecipient,
            fingerprint: 'fp_age_5e6f7a8b9c0d1e2f',
            algorithm: 'X25519 age-encryption',
            createdIso: '2025-02-01T11:20:00Z',
            usageCount: 215,
            isHardwareBacked: true,
          },
        ],
      },
    ],
  },
  {
    id: 'id-devops',
    name: 'DevOps & Infra Identity',
    handle: '@infra.sentinel',
    avatarColor: 'from-cyan-500 to-blue-700',
    status: IdentityStatus.Active,
    createdIso: '2025-03-10T11:00:00Z',
    chainStrengthScore: 92,
    devices: [
      {
        id: 'dev-yubikey-backup',
        name: 'YubiKey 5 Nano (Server Rack)',
        deviceType: DeviceType.SecurityKey,
        os: 'YubiKey Firmware 5.4.3',
        lastActiveIso: '2026-08-02T16:00:00Z',
        trustScore: 96,
        keys: [
          {
            id: 'key-ed25519-infra',
            name: 'Cluster Release Signer',
            keyType: KeyType.SigningEd25519,
            fingerprint: 'fp_ed25519_9988776655443322',
            algorithm: 'Ed25519',
            createdIso: '2025-03-10T11:15:00Z',
            usageCount: 1890,
            isHardwareBacked: true,
          },
        ],
      },
      {
        id: 'dev-linux-rig',
        name: 'Build Node #01 (Arch Linux)',
        deviceType: DeviceType.Workstation,
        os: 'Linux 6.12.8-arch',
        lastActiveIso: '2026-08-03T21:00:00Z',
        trustScore: 88,
        keys: [
          {
            id: 'key-x25519-linux',
            name: 'Node Exchange Key',
            keyType: KeyType.DeviceX25519,
            fingerprint: 'fp_x25519_1122334455667788',
            algorithm: 'X25519 Curve25519',
            createdIso: '2025-03-12T08:00:00Z',
            usageCount: 540,
            isHardwareBacked: false,
          },
        ],
      },
    ],
  },
  {
    id: 'id-recovery',
    name: 'Custody & Recovery Identity',
    handle: '@custody.cold',
    avatarColor: 'from-amber-500 to-orange-700',
    status: IdentityStatus.Verified,
    createdIso: '2025-02-20T16:45:00Z',
    chainStrengthScore: 100,
    devices: [
      {
        id: 'dev-ledger',
        name: 'Ledger Nano S Plus (Cold Vault)',
        deviceType: DeviceType.HardwareSigner,
        os: 'Ledger OS 2.2.4',
        lastActiveIso: '2026-07-28T12:00:00Z',
        trustScore: 100,
        keys: [
          {
            id: 'key-piv-ledger',
            name: 'Shamir Recovery Seed #01',
            keyType: KeyType.PivSlot,
            fingerprint: 'fp_piv_cold_aaaa1111bbbb2222',
            algorithm: 'SLIP-0039 / RSA-4096',
            createdIso: '2025-02-20T17:00:00Z',
            usageCount: 14,
            isHardwareBacked: true,
          },
        ],
      },
    ],
  },
]

export const MOCK_VAULTS: VaultItem[] = [
  {
    id: 'vault-personal',
    name: 'Personal Primary Vault',
    description: 'Master passwords, passkeys, biometric envelopes, and personal recovery phrases.',
    policyType: VaultPolicyType.SingleOwner,
    thresholdK: 1,
    totalN: 1,
    itemCount: 148,
    lastSyncedIso: '2026-08-03T21:50:00Z',
    associatedIdentityIds: ['id-main'],
    identityRoles: {
      'id-main': VaultRole.Owner,
    },
  },
  {
    id: 'vault-sentinel-core',
    name: 'Sentinel 2-of-3 Threshold Vault',
    description: 'Core infrastructure secrets and threshold quorum encryption keys.',
    policyType: VaultPolicyType.ThresholdQuorum,
    thresholdK: 2,
    totalN: 3,
    itemCount: 42,
    lastSyncedIso: '2026-08-03T20:30:00Z',
    associatedIdentityIds: ['id-main', 'id-devops', 'id-recovery'],
    identityRoles: {
      'id-main': VaultRole.FullSigner,
      'id-devops': VaultRole.ThresholdParticipant,
      'id-recovery': VaultRole.RecoveryGuardian,
    },
  },
  {
    id: 'vault-engineering-prod',
    name: 'Engineering Production Secrets',
    description: 'Production API keys, TLS certificates, and cloud provider credentials.',
    policyType: VaultPolicyType.ThresholdQuorum,
    thresholdK: 2,
    totalN: 2,
    itemCount: 89,
    lastSyncedIso: '2026-08-03T18:15:00Z',
    associatedIdentityIds: ['id-main', 'id-devops'],
    identityRoles: {
      'id-main': VaultRole.Owner,
      'id-devops': VaultRole.FullSigner,
    },
  },
  {
    id: 'vault-emergency-recovery',
    name: 'Emergency Custody & Break-Glass',
    description: 'Break-glass emergency recovery keys and cold backup parameters.',
    policyType: VaultPolicyType.MultisigRecovery,
    thresholdK: 2,
    totalN: 3,
    itemCount: 8,
    lastSyncedIso: '2026-07-28T12:30:00Z',
    associatedIdentityIds: ['id-main', 'id-recovery'],
    identityRoles: {
      'id-main': VaultRole.Owner,
      'id-recovery': VaultRole.RecoveryGuardian,
    },
  },
]
