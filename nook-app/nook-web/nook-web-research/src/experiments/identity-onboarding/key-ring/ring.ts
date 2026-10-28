/**
 * Key management as one key ring. Onboarding has two branches: create an
 * identity on this browser (a sync provider can come later), or import one
 * from a sync provider (unlock yours, or ask to join a locked one). After
 * that the whole app is the ring: your identity in the middle, the keys that
 * open it on one side, the places it is synced to on the other. Adding a
 * provider that holds another identity of yours merges it into the ring.
 */
import { stranger, work, type IdentityFixture } from '../key-machine/machine'

export enum RingState {
  Start = 'start',
  Create = 'create',
  Import = 'import',
  Found = 'found',
  Linking = 'linking',
  Home = 'home',
  AddProvider = 'add-provider',
  Merge = 'merge',
  AddKey = 'add-key',
}

/** What the simulated sync provider holds. */
export enum ProviderHolds {
  Nothing = 'nothing',
  /** Identities, and your passkey unlocks the first. */
  Yours = 'yours',
  /** Identities none of your keys unlock. */
  Locked = 'locked',
}

export enum RingGroup {
  Onboarding = 'Onboarding',
  Ring = 'Key ring',
}

export type RingNode = {
  readonly state: RingState
  readonly title: string
  readonly group: RingGroup
  readonly next: readonly { readonly to: RingState; readonly label: string }[]
}

export const ring: readonly RingNode[] = [
  {
    state: RingState.Start,
    title: 'Nothing on this browser',
    group: RingGroup.Onboarding,
    next: [
      { to: RingState.Create, label: 'create locally' },
      { to: RingState.Import, label: 'import from sync provider' },
    ],
  },
  {
    state: RingState.Create,
    title: 'Create identity',
    group: RingGroup.Onboarding,
    next: [{ to: RingState.Home, label: 'passkey created' }],
  },
  {
    state: RingState.Import,
    title: 'Pick sync provider',
    group: RingGroup.Onboarding,
    next: [{ to: RingState.Found, label: 'signed in' }],
  },
  {
    state: RingState.Found,
    title: 'Which is yours?',
    group: RingGroup.Onboarding,
    next: [
      { to: RingState.Home, label: 'unlocks → use it' },
      { to: RingState.Linking, label: 'locked → ask to join' },
      { to: RingState.Create, label: 'provider empty → create' },
    ],
  },
  {
    state: RingState.Linking,
    title: 'Waiting for approval',
    group: RingGroup.Onboarding,
    next: [{ to: RingState.Home, label: 'other device approves' }],
  },
  {
    state: RingState.Home,
    title: 'Key ring',
    group: RingGroup.Ring,
    next: [
      { to: RingState.AddKey, label: '+ key' },
      { to: RingState.AddProvider, label: '+ sync provider' },
    ],
  },
  {
    state: RingState.AddKey,
    title: 'Add key',
    group: RingGroup.Ring,
    next: [{ to: RingState.Home, label: 'key added' }],
  },
  {
    state: RingState.AddProvider,
    title: 'Add sync provider',
    group: RingGroup.Ring,
    next: [
      { to: RingState.Home, label: 'empty → synced' },
      { to: RingState.Merge, label: 'holds identities' },
    ],
  },
  {
    state: RingState.Merge,
    title: 'Found on provider',
    group: RingGroup.Ring,
    next: [{ to: RingState.Home, label: 'yours merged, saved' }],
  },
]

/** The identities a provider holds, when it holds any. */
export const found: readonly IdentityFixture[] = [work, stranger]

/** What one identity on a provider looks like to you right now. */
export enum Standing {
  /** Not tried yet. */
  Unknown = 'unknown',
  /** Your passkey unlocked it, or a device approved you. */
  Yours = 'yours',
  /** Your passkey did not unlock it. */
  Locked = 'locked',
  /** You asked to join; its devices have not answered. */
  Asked = 'asked',
}

/** The code both devices show while one approves the other. */
export const linkCode = '472 916'

/** Devices that ask to join your identity, in the order the simulator sends
 * them. */
export const askingDevices = ['iPad', 'Work laptop', 'Pixel'] as const
