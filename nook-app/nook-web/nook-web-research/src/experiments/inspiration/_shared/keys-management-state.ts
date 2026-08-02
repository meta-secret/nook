/**
 * The one fixture every Keys management experiment reads. Each sketch may look
 * completely different, but they all answer the same three questions with the
 * same facts: which passkey protects this browser, which device key it unlocks,
 * and which vaults that key opens.
 */

export enum BrowserProtection {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  PasskeyRecoverable = 'passkey-recoverable',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  PasskeyHighSecurity = 'passkey-high-security',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  NotPrepared = 'not-prepared',
}

export enum IdentityState {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unlocked = 'unlocked',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Locked = 'locked',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Missing = 'missing',
}

export enum ChainStage {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Passkey = 'passkey',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  DeviceKey = 'device-key',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Vaults = 'vaults',
}

export const CHAIN_STAGES: readonly ChainStage[] = [
  ChainStage.Passkey,
  ChainStage.DeviceKey,
  ChainStage.Vaults,
]

export enum VaultTrust {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Verified = 'verified',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unverified = 'unverified',
}

/** A fact Nook may simply not have observed yet. Absence is a state, not a hole. */
export enum FactKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Known = 'known',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  NotObserved = 'not-observed',
}

export type Fact =
  | { kind: FactKind.Known; value: string }
  | { kind: FactKind.NotObserved; reason: string }

export function known(value: string): Fact {
  return { kind: FactKind.Known, value }
}

export function notObserved(reason: string): Fact {
  return { kind: FactKind.NotObserved, reason }
}

export function factText(fact: Fact): string {
  return fact.kind === FactKind.Known ? fact.value : fact.reason
}

export interface VaultLink {
  id: string
  label: string
  trust: VaultTrust
  verifiedAt: Fact
  lastLocalUpdateAt: Fact
  enrolledDevices: number
  backupPasswords: number
}

export interface PasskeyFacts {
  name: Fact
  fingerprint: Fact
  savedIn: Fact
  createdAt: Fact
  lastUsedAt: Fact
  transports: string[]
  backupState: string
  attachment: string
  aaguid: Fact
}

export interface DeviceKeyFacts {
  id: Fact
  browser: string
  platform: string
  preparedAt: Fact
  boundary: string
}

export enum ScenarioId {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unlocked = 'unlocked',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Shared = 'shared',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unprepared = 'unprepared',
}

export interface AccessScenario {
  id: ScenarioId
  label: string
  protection: BrowserProtection
  protectionLabel: string
  identity: IdentityState
  identityLabel: string
  passkey: PasskeyFacts
  device: DeviceKeyFacts
  vaults: VaultLink[]
}

const unlockedScenario: AccessScenario = {
  id: ScenarioId.Unlocked,
  label: 'One vault',
  protection: BrowserProtection.PasskeyRecoverable,
  protectionLabel: 'Passkey · recoverable identity',
  identity: IdentityState.Unlocked,
  identityLabel: 'Identity unlocked',
  passkey: {
    name: known('Nook device'),
    fingerprint: known('passkey_ae216c2ef5247a37'),
    savedIn: known('iCloud Keychain'),
    createdAt: known('12 Mar 2026, 09:14'),
    lastUsedAt: known('2 Aug 2026, 10:26'),
    transports: ['internal', 'hybrid'],
    backupState: 'Synced across your passkey manager',
    attachment: 'This platform',
    aaguid: known('adce0002-35bc-c60a-648b-0b25f1f05503'),
  },
  device: {
    id: known('7c9dd12a77a95f24'),
    browser: 'Chrome 141',
    platform: 'macOS 15',
    preparedAt: known('12 Mar 2026, 09:14'),
    boundary: 'Backup passwords stay wrapped in this browser and never sync.',
  },
  vaults: [
    {
      id: 'store_5f0a',
      label: 'Test vault',
      trust: VaultTrust.Verified,
      verifiedAt: known('2 Aug 2026, 10:26'),
      lastLocalUpdateAt: known('2 Aug 2026, 10:27'),
      enrolledDevices: 1,
      backupPasswords: 1,
    },
  ],
}

const sharedScenario: AccessScenario = {
  id: ScenarioId.Shared,
  label: 'Several vaults',
  protection: BrowserProtection.PasskeyHighSecurity,
  protectionLabel: 'Passkey · high security',
  identity: IdentityState.Unlocked,
  identityLabel: 'Identity unlocked',
  passkey: {
    name: known('Work laptop'),
    fingerprint: known('passkey_31b7d90c14ee6b02'),
    savedIn: known('1Password'),
    createdAt: known('4 Jan 2026, 18:02'),
    lastUsedAt: known('2 Aug 2026, 08:41'),
    transports: ['usb', 'internal'],
    backupState: 'Device-bound — this passkey cannot leave the manager',
    attachment: 'This platform',
    aaguid: known('08987058-cadc-4b81-b6e1-30de50dcbe96'),
  },
  device: {
    id: known('c4f9eac14b4e7865'),
    browser: 'Firefox 139',
    platform: 'Ubuntu 26.04',
    preparedAt: known('4 Jan 2026, 18:03'),
    boundary: 'Backup passwords stay wrapped in this browser and never sync.',
  },
  vaults: [
    {
      id: 'store_5f0a',
      label: 'Personal',
      trust: VaultTrust.Verified,
      verifiedAt: known('2 Aug 2026, 08:41'),
      lastLocalUpdateAt: known('2 Aug 2026, 09:55'),
      enrolledDevices: 3,
      backupPasswords: 2,
    },
    {
      id: 'store_9c31',
      label: 'Household',
      trust: VaultTrust.Verified,
      verifiedAt: known('29 Jul 2026, 21:10'),
      lastLocalUpdateAt: known('1 Aug 2026, 07:12'),
      enrolledDevices: 2,
      backupPasswords: 1,
    },
    {
      id: 'store_2ad7',
      label: 'Archive 2024',
      trust: VaultTrust.Unverified,
      verifiedAt: notObserved('This key has never opened it'),
      lastLocalUpdateAt: known('11 Nov 2025, 13:40'),
      enrolledDevices: 1,
      backupPasswords: 0,
    },
  ],
}

const unpreparedScenario: AccessScenario = {
  id: ScenarioId.Unprepared,
  label: 'New browser',
  protection: BrowserProtection.NotPrepared,
  protectionLabel: 'Not prepared yet',
  identity: IdentityState.Missing,
  identityLabel: 'No identity on this browser',
  passkey: {
    name: notObserved('No passkey yet'),
    fingerprint: notObserved('Created when you prepare this browser'),
    savedIn: notObserved('You choose the manager'),
    createdAt: notObserved('Not created'),
    lastUsedAt: notObserved('Never used'),
    transports: [],
    backupState: 'Decided by your passkey manager at creation',
    attachment: 'Not chosen yet',
    aaguid: notObserved('Reported by the manager at creation'),
  },
  device: {
    id: notObserved('Derived when the passkey first unlocks'),
    browser: 'Chrome 141',
    platform: 'macOS 15',
    preparedAt: notObserved('Not prepared'),
    boundary: 'Nothing is stored in this browser yet.',
  },
  vaults: [],
}

export const scenarios: readonly AccessScenario[] = [
  unlockedScenario,
  sharedScenario,
  unpreparedScenario,
]

export function scenarioById(id: ScenarioId): AccessScenario {
  const match = scenarios.find((scenario) => scenario.id === id)
  return match ? match : unlockedScenario
}

export function isPrepared(scenario: AccessScenario): boolean {
  return scenario.protection !== BrowserProtection.NotPrepared
}

export function verifiedVaults(scenario: AccessScenario): VaultLink[] {
  return scenario.vaults.filter((vault) => vault.trust === VaultTrust.Verified)
}

export function verifiedSummary(scenario: AccessScenario): string {
  if (scenario.vaults.length === 0) return 'No vaults on this browser'
  return `${verifiedVaults(scenario).length} of ${scenario.vaults.length} verified`
}

/** The verb drawn on the connector that arrives at a stage. */
export function relationInto(stage: ChainStage): string {
  if (stage === ChainStage.DeviceKey) return 'unlocks'
  return stage === ChainStage.Vaults ? 'opens' : 'presents'
}

export function stageCaption(stage: ChainStage): string {
  if (stage === ChainStage.Passkey) return 'Passkey'
  return stage === ChainStage.DeviceKey ? 'Device key' : 'Vaults'
}
