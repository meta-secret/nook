/** Which situation the prototype shows. */
export enum Scenario {
  FirstRun = 'first-run',
  ConnectProvider = 'connect-provider',
  Hub = 'hub',
}

/** Whether the simulated passkey tap belongs to an identity on the provider. */
export enum PasskeyOutcome {
  Matches = 'matches',
  NoMatch = 'no-match',
}

export enum Provider {
  GoogleDrive = 'google-drive',
  ICloud = 'icloud',
  GitHub = 'github',
  Folder = 'folder',
}

export const providers: readonly { id: Provider; label: string; account: string }[] = [
  { id: Provider.GoogleDrive, label: 'Google Drive', account: 'bynull@meta-secret.org' },
  { id: Provider.ICloud, label: 'iCloud', account: 'iCloud Drive' },
  { id: Provider.GitHub, label: 'GitHub', account: 'meta-secret/nook-backup' },
  { id: Provider.Folder, label: 'A folder', account: '~/Sync/meta-secret-nook' },
]

/** An identity as a provider or this browser knows it. */
export type IdentityFixture = {
  readonly id: string
  readonly name: string
  readonly words: string
  readonly devices: number
  readonly vaults: number
}

/** Yours: the passkey on this computer belongs to it. */
export const personal: IdentityFixture = {
  id: 'idn_personal',
  name: 'Personal',
  words: 'amber-falcon-tide',
  devices: 2,
  vaults: 3,
}

export const work: IdentityFixture = {
  id: 'idn_work',
  name: 'Work',
  words: 'ripple-canvas-orbit',
  devices: 1,
  vaults: 2,
}

/** Someone else's identity in the same shared folder. */
export const stranger: IdentityFixture = {
  id: 'idn_stranger',
  name: '',
  words: 'clap-feel-strong',
  devices: 1,
  vaults: 1,
}

/** Every identity the provider's Nook folder keeps. */
export const folderIdentities: readonly IdentityFixture[] = [personal, work, stranger]

export function providerLabel(id: Provider): string {
  return providers.find((provider) => provider.id === id)?.label ?? id
}

/** Where bringing an existing identity starts from. */
export enum BringContext {
  /** A browser with no identity yet. */
  FirstRun = 'first-run',
  /** The Identities hub, beside the identity in use. */
  Hub = 'hub',
}

/** The steps of bringing an existing identity to this browser. */
export enum BringStep {
  Provider = 'provider',
  SignedIn = 'signed-in',
  Matched = 'matched',
  NoMatch = 'no-match',
  AskDevice = 'ask-device',
  Asked = 'asked',
}

/** Where first run is. */
export enum FirstRunStep {
  Start = 'start',
  NameIdentity = 'name-identity',
  Passkey = 'passkey',
  Sync = 'sync',
  FirstVault = 'first-vault',
  Ready = 'ready',
  Bring = 'bring',
  Opened = 'opened',
  JoinCode = 'join-code',
}

export enum ConnectStep {
  Provider = 'provider',
  Review = 'review',
  Connected = 'connected',
}

export enum HubStep {
  List = 'list',
  Bring = 'bring',
  ConfirmMerge = 'confirm-merge',
}
