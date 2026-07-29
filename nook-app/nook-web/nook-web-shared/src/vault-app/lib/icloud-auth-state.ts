import type { CloudKitUserIdentity } from '$lib/icloud-cloudkit-runtime'

export enum CloudKitInitializationKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

export type CloudKitInitialization =
  | { kind: CloudKitInitializationKind.NotStarted }
  | {
      kind: CloudKitInitializationKind.Initializing
      completion: Promise<void>
    }

export enum CloudKitAuthSetupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

export type CloudKitAuthSetup =
  | { kind: CloudKitAuthSetupKind.NotStarted }
  | {
      kind: CloudKitAuthSetupKind.Initializing
      completion: Promise<CloudKitIdentity>
    }

export enum CloudKitIdentityKind {
  SignedOut = 'signed-out',
  SignedIn = 'signed-in',
}

export type CloudKitIdentity =
  | { kind: CloudKitIdentityKind.SignedOut }
  | { kind: CloudKitIdentityKind.SignedIn; identity: CloudKitUserIdentity }
