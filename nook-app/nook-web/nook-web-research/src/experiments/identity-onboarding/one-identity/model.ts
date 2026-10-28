/**
 * One identity per browser, managed as the devices whose keys open it. No
 * vaults here. Onboarding creates the identity on this browser or imports it
 * from a sync provider. An identity shows as a sigil drawn from its three
 * public words, so a locked identity is recognisable before its sealed name
 * is known.
 */

export enum Step {
  Welcome = 'welcome',
  Create = 'create',
  Import = 'import',
  Found = 'found',
  Waiting = 'waiting',
  Home = 'home',
  Sync = 'sync',
  More = 'more',
  AddDevice = 'add-device',
}

export enum Branch {
  Start = 'Start',
  Local = 'Create locally',
  Import = 'Import',
  Home = 'Your identity',
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
  Browser = 'browser',
  Laptop = 'laptop',
  Phone = 'phone',
  SecurityKey = 'security-key',
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
  /** Sealed to its members; shown once it is yours. */
  readonly name: string
  readonly words: string
  readonly keys: readonly Key[]
}

export enum ProviderKind {
  Drive = 'drive',
  ICloud = 'icloud',
  GitHub = 'github',
  Folder = 'folder',
}

export type Provider = {
  readonly kind: ProviderKind
  readonly name: string
}

export const googleDrive: Provider = { kind: ProviderKind.Drive, name: 'Google Drive' }

export const providers: readonly Provider[] = [
  googleDrive,
  { kind: ProviderKind.ICloud, name: 'iCloud' },
  { kind: ProviderKind.GitHub, name: 'GitHub' },
  { kind: ProviderKind.Folder, name: 'A folder' },
]

export const browserKey: Key = { id: 'key_browser', kind: KeyKind.Browser, device: 'This browser', here: true }

export const work: Identity = {
  id: 'idn_work',
  name: 'Work',
  words: 'ripple-canvas-orbit',
  keys: [
    { id: 'key_macbook', kind: KeyKind.Laptop, device: 'MacBook', here: false },
    { id: 'key_iphone', kind: KeyKind.Phone, device: 'iPhone', here: false },
  ],
}

export const laptop: Identity = {
  id: 'idn_laptop',
  name: 'Laptop',
  words: 'clap-feel-strong',
  keys: [{ id: 'key_thinkpad', kind: KeyKind.Laptop, device: 'ThinkPad', here: false }],
}

/** What a provider holds when it holds identities; your passkey unlocks the
 * first when the simulator says so. */
export const providerIdentities: readonly Identity[] = [work, laptop]

/** Devices that ask to join, in the order the simulator sends them. */
export const askingDevices = ['iPad', 'Pixel', 'Desktop'] as const

/** The code both devices show while one approves the other. */
export const linkCode = '472 916'

export type StepNode = {
  readonly step: Step
  readonly title: string
  readonly branch: Branch
}

export const steps: readonly StepNode[] = [
  { step: Step.Welcome, title: 'Welcome', branch: Branch.Start },
  { step: Step.Create, title: 'Create with passkey', branch: Branch.Local },
  { step: Step.Import, title: 'Pick sync provider', branch: Branch.Import },
  { step: Step.Found, title: 'Which is yours?', branch: Branch.Import },
  { step: Step.Waiting, title: 'Waiting for approval', branch: Branch.Import },
  { step: Step.Home, title: 'Home', branch: Branch.Home },
  { step: Step.Sync, title: 'Turn on sync', branch: Branch.Home },
  { step: Step.More, title: 'More on provider', branch: Branch.Home },
  { step: Step.AddDevice, title: 'Add device', branch: Branch.Home },
]
