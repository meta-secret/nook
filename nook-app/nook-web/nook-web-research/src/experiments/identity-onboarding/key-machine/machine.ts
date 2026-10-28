/**
 * Key management as a state machine. There are no vaults here: an identity
 * is the set of keys that open it (passkeys, devices), and everything the
 * user does is about which keys open which identity. The browser keeps one
 * identity and never switches: an identity of yours found elsewhere merges
 * into it and only adds keys.
 */
export enum KeyState {
  Empty = 'empty',
  CreateIdentity = 'create-identity',
  LocalIdentity = 'local-identity',
  ConnectProvider = 'connect-provider',
  Synced = 'synced',
  RemoteIdentities = 'remote-identities',
  JoinPending = 'join-pending',
  ImportProvider = 'import-provider',
  ImportPasskey = 'import-passkey',
  ImportChoose = 'import-choose',
  UsingRemote = 'using-remote',
}

/** What the simulated sync provider holds besides your identity. */
export enum ProviderHolds {
  Nothing = 'nothing',
  Identities = 'identities',
}

/** Whether your passkey is one of the remote identity's keys. */
export enum PasskeyFit {
  Opens = 'opens',
  Sealed = 'sealed',
}

/** One state of the map: its name, the group it belongs to, and the states
 * it can move to. */
export type StateNode = {
  readonly state: KeyState
  readonly title: string
  readonly group: StateGroup
  readonly next: readonly { readonly to: KeyState; readonly label: string }[]
}

export enum StateGroup {
  Start = 'Start',
  Local = 'Your identity',
  Remote = 'Remote identities',
  Import = 'Import (onboarding)',
}

export const machine: readonly StateNode[] = [
  {
    state: KeyState.Empty,
    title: 'Nothing on this browser',
    group: StateGroup.Start,
    next: [
      { to: KeyState.CreateIdentity, label: 'create locally' },
      { to: KeyState.ImportProvider, label: 'import from provider' },
    ],
  },
  {
    state: KeyState.CreateIdentity,
    title: 'Create identity',
    group: StateGroup.Local,
    next: [{ to: KeyState.LocalIdentity, label: 'passkey created' }],
  },
  {
    state: KeyState.LocalIdentity,
    title: 'Local identity',
    group: StateGroup.Local,
    next: [{ to: KeyState.ConnectProvider, label: 'back up' }],
  },
  {
    state: KeyState.ConnectProvider,
    title: 'Pick sync provider',
    group: StateGroup.Local,
    next: [
      { to: KeyState.Synced, label: 'provider empty' },
      { to: KeyState.RemoteIdentities, label: 'holds identities' },
    ],
  },
  {
    state: KeyState.Synced,
    title: 'Backed up',
    group: StateGroup.Local,
    next: [{ to: KeyState.RemoteIdentities, label: 'more on provider' }],
  },
  {
    state: KeyState.RemoteIdentities,
    title: 'Remote identities found',
    group: StateGroup.Remote,
    next: [
      { to: KeyState.JoinPending, label: 'sealed to you → join request' },
      { to: KeyState.Synced, label: 'yours merged, rest skipped' },
    ],
  },
  {
    state: KeyState.JoinPending,
    title: 'Join request sent',
    group: StateGroup.Remote,
    next: [
      { to: KeyState.RemoteIdentities, label: 'approved → merge it' },
      { to: KeyState.UsingRemote, label: 'approved (onboarding)' },
    ],
  },
  {
    state: KeyState.ImportProvider,
    title: 'Pick sync provider',
    group: StateGroup.Import,
    next: [{ to: KeyState.ImportPasskey, label: 'signed in' }],
  },
  {
    state: KeyState.ImportPasskey,
    title: 'Find yours by passkey',
    group: StateGroup.Import,
    next: [
      { to: KeyState.UsingRemote, label: 'passkey opens one' },
      { to: KeyState.ImportChoose, label: 'opens none' },
    ],
  },
  {
    state: KeyState.ImportChoose,
    title: 'Pick yours by its words',
    group: StateGroup.Import,
    next: [{ to: KeyState.JoinPending, label: 'join request' }],
  },
  {
    state: KeyState.UsingRemote,
    title: 'Using your identity',
    group: StateGroup.Import,
    next: [],
  },
]

/** One key that opens an identity. */
export type KeyFixture = {
  readonly id: string
  readonly kind: 'passkey' | 'device'
  readonly label: string
  readonly here: boolean
}

export type IdentityFixture = {
  readonly id: string
  readonly name: string
  readonly words: string
  readonly keys: readonly KeyFixture[]
}

export const thisBrowserPasskey: KeyFixture = {
  id: 'passkey_a1b2c3d4',
  kind: 'passkey',
  label: 'This browser · passkey a1b2c3d4',
  here: true,
}

export const work: IdentityFixture = {
  id: 'idn_work',
  name: 'Work',
  words: 'ripple-canvas-orbit',
  keys: [
    { id: 'passkey_9f8e7d6c', kind: 'passkey', label: 'MacBook · passkey 9f8e7d6c', here: false },
    { id: 'device_5b4a', kind: 'device', label: 'iPhone · device key 5b4a', here: false },
  ],
}

export const stranger: IdentityFixture = {
  id: 'idn_stranger',
  name: '',
  words: 'clap-feel-strong',
  keys: [{ id: 'passkey_00ffaa11', kind: 'passkey', label: 'Laptop · passkey 00ffaa11', here: false }],
}

/** The identities a provider keeps besides the one in use. */
export const remoteIdentities: readonly IdentityFixture[] = [work, stranger]

export const providerNames = ['Google Drive', 'iCloud', 'GitHub', 'A folder'] as const

/** How an identity token looks in a scene. */
export enum TokenStatus {
  /** On this browser, in use. */
  Here = 'here',
  /** Being created. */
  Ghost = 'ghost',
  /** Kept by the provider and open to you. */
  Synced = 'synced',
  /** Kept by the provider; none of your keys opens it. */
  Sealed = 'sealed',
  /** Your passkey just opened it; its name shows. */
  Opened = 'opened',
  /** A join request waits on its devices. */
  Pending = 'pending',
}

/** One identity drawn in a scene. */
export type Token = {
  readonly id: string
  readonly label: string
  readonly keys: number
  readonly status: TokenStatus
}

/** What links this browser and the provider in a scene. */
export enum SceneLink {
  None = 'none',
  Sync = 'sync',
  Request = 'request',
  Passkey = 'passkey',
}
