/**
 * Key management before vaults. A browser holds one identity, and an
 * identity is the set of keys that open it. Onboarding has two branches:
 * create an identity on this browser, or import one from a sync provider.
 * After that everything happens on one key ring: keys on one side, sync
 * providers on the other. Another identity of yours found on a provider
 * merges into the ring; one your keys do not open is asked to join.
 */

export enum Step {
  Start = 'start',
  Create = 'create',
  Import = 'import',
  Found = 'found',
  Waiting = 'waiting',
  Ring = 'ring',
  AddKey = 'add-key',
  AddProvider = 'add-provider',
  Provider = 'provider',
}

export enum Branch {
  Start = 'Start',
  Local = 'Create locally',
  Import = 'Import from sync provider',
  Ring = 'Key ring',
}

/** What the simulated sync provider holds. */
export enum ProviderHolds {
  /** Identities, and your passkey unlocks the first. */
  Yours = 'yours',
  /** Identities none of your keys unlock. */
  Locked = 'locked',
  Nothing = 'nothing',
}

/** One provider identity as it stands with you. */
export enum Standing {
  Unknown = 'unknown',
  /** Your passkey unlocked it, or a device approved you. */
  Yours = 'yours',
  /** Your passkey did not unlock it. */
  Locked = 'locked',
  /** You asked to join; its devices have not answered. */
  Asked = 'asked',
}

export enum KeyKind {
  Passkey = 'passkey',
  Device = 'device',
}

export type Key = {
  readonly id: string
  readonly kind: KeyKind
  readonly device: string
  /** The key of this browser. */
  readonly here: boolean
}

export type Identity = {
  readonly id: string
  /** Sealed to its members; empty while it is locked to you. */
  readonly name: string
  readonly words: string
  readonly keys: readonly Key[]
}

export const browserKey: Key = { id: 'key_browser', kind: KeyKind.Passkey, device: 'This browser', here: true }

export const work: Identity = {
  id: 'idn_work',
  name: 'Work',
  words: 'ripple-canvas-orbit',
  keys: [
    { id: 'key_macbook', kind: KeyKind.Passkey, device: 'MacBook', here: false },
    { id: 'key_iphone', kind: KeyKind.Device, device: 'iPhone', here: false },
  ],
}

export const laptop: Identity = {
  id: 'idn_laptop',
  name: 'Laptop',
  words: 'clap-feel-strong',
  keys: [{ id: 'key_laptop', kind: KeyKind.Passkey, device: 'Laptop', here: false }],
}

/** What a provider holds when it holds identities; the first is the one a
 * passkey of yours unlocks. */
export const providerIdentities: readonly Identity[] = [work, laptop]

export const providers = ['Google Drive', 'iCloud', 'GitHub', 'A folder'] as const

/** Devices that ask to join, in the order the simulator sends them. */
export const askingDevices = ['iPad', 'Pixel', 'Desktop'] as const

/** The code both devices show while one approves the other. */
export const linkCode = '472 916'

export type StepNode = {
  readonly step: Step
  readonly title: string
  readonly branch: Branch
  readonly next: readonly { readonly to: Step; readonly label: string }[]
}

export const steps: readonly StepNode[] = [
  {
    step: Step.Start,
    title: 'Nothing on this browser',
    branch: Branch.Start,
    next: [
      { to: Step.Create, label: 'create locally' },
      { to: Step.Import, label: 'import' },
    ],
  },
  {
    step: Step.Create,
    title: 'Name it, create passkey',
    branch: Branch.Local,
    next: [{ to: Step.Ring, label: 'passkey created' }],
  },
  {
    step: Step.Import,
    title: 'Pick sync provider',
    branch: Branch.Import,
    next: [{ to: Step.Found, label: 'signed in' }],
  },
  {
    step: Step.Found,
    title: 'Which is yours?',
    branch: Branch.Import,
    next: [
      { to: Step.Ring, label: 'unlocks → use it' },
      { to: Step.Waiting, label: 'locked → ask to join' },
      { to: Step.Create, label: 'empty → create' },
    ],
  },
  {
    step: Step.Waiting,
    title: 'Waiting for approval',
    branch: Branch.Import,
    next: [{ to: Step.Ring, label: 'approved' }],
  },
  {
    step: Step.Ring,
    title: 'Key ring',
    branch: Branch.Ring,
    next: [
      { to: Step.AddKey, label: '+ key' },
      { to: Step.AddProvider, label: '+ sync provider' },
    ],
  },
  {
    step: Step.AddKey,
    title: 'Add key',
    branch: Branch.Ring,
    next: [{ to: Step.Ring, label: 'key added' }],
  },
  {
    step: Step.AddProvider,
    title: 'Add sync provider',
    branch: Branch.Ring,
    next: [
      { to: Step.Ring, label: 'empty → synced' },
      { to: Step.Provider, label: 'holds identities' },
    ],
  },
  {
    step: Step.Provider,
    title: 'Identities on provider',
    branch: Branch.Ring,
    next: [{ to: Step.Ring, label: 'saved, yours merged' }],
  },
]
