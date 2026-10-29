/**
 * Nook setup as one straight path: create an identity, create or use a
 * passkey, connect Google Drive, let Nook read the identities in its folder,
 * then continue with one your passkey is a member of, ask to join one it is
 * not, or create a new one there. The passkey chosen in step two decides
 * membership, so no identity needs another tap to check.
 */

export enum Step {
  Start = 'start',
  Passkey = 'passkey',
  Provider = 'provider',
  Identities = 'identities',
  Join = 'join',
  Name = 'name',
  Sync = 'sync',
}

/** The passkey this browser uses. */
export enum PasskeyChoice {
  New = 'new',
  Existing = 'existing',
}

/** Simulator: which identity in the folder an existing passkey belongs to.
 * A new passkey belongs to none. */
export enum MemberOf {
  Work = 'work',
  Nothing = 'nothing',
}

/** Simulator: what the Nook folder in Google Drive holds. */
export enum FolderHolds {
  Identities = 'identities',
  Nothing = 'nothing',
}

export type Identity = {
  readonly id: string
  /** Sealed to members; shown only to them. */
  readonly name: string
  /** Public, readable by anyone with the folder. */
  readonly words: string
  readonly devices: number
}

export const work: Identity = {
  id: 'idn_work',
  name: 'Work',
  words: 'ripple-canvas-orbit',
  devices: 3,
}
export const family: Identity = {
  id: 'idn_family',
  name: 'Family',
  words: 'clap-feel-strong',
  devices: 2,
}

/** The identities in the folder when it holds any. */
export const folderIdentities: readonly Identity[] = [work, family]

export const account = 'you@example.com'
export const folder = ['My Drive', 'Nook'] as const
export const joinCode = '472 916'

/** Events a member pulls when it finishes setup on an existing identity;
 * a new identity starts with its own genesis events. */
export const existingEvents = 48
export const newEvents = 3

/** The three stages the progress bar shows. */
export enum Stage {
  Passkey = 'Passkey',
  Sync = 'Sync provider',
  Identity = 'Identity',
}

export type StepNode = {
  readonly step: Step
  readonly title: string
  readonly stage: number
}

/** Every step, its rail title, and how many stages it has reached. */
export const steps: readonly StepNode[] = [
  { step: Step.Start, title: 'Create identity', stage: 0 },
  { step: Step.Passkey, title: 'Create or use passkey', stage: 1 },
  { step: Step.Provider, title: 'Add Google Drive', stage: 2 },
  { step: Step.Identities, title: 'Identities in Drive', stage: 3 },
  { step: Step.Join, title: 'Join request', stage: 3 },
  { step: Step.Name, title: 'Name new identity', stage: 3 },
  { step: Step.Sync, title: 'Sync events', stage: 4 },
]
