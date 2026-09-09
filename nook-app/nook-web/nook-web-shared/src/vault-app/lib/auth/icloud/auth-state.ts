import type { Result } from 'neverthrow'
import type { OAuthFailure } from '$lib/auth/oauth-failure'
import type { CloudKitUserIdentity } from '$lib/auth/icloud/cloudkit-runtime'

export enum CloudKitInitializationKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

export type CloudKitInitialization =
  | { kind: CloudKitInitializationKind.NotStarted }
  | {
      kind: CloudKitInitializationKind.Initializing
      completion: Promise<Result<void, OAuthFailure>>
    }

export enum CloudKitAuthSetupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

export type CloudKitAuthSetup =
  | { kind: CloudKitAuthSetupKind.NotStarted }
  | {
      kind: CloudKitAuthSetupKind.Initializing
      completion: Promise<Result<CloudKitIdentity, OAuthFailure>>
    }

export enum CloudKitIdentityKind {
  SignedOut = 'signed-out',
  SignedIn = 'signed-in',
}

export type CloudKitIdentity =
  | { kind: CloudKitIdentityKind.SignedOut }
  | { kind: CloudKitIdentityKind.SignedIn; identity: CloudKitUserIdentity }

export enum ICloudAccountNameKind {
  Unavailable = 'unavailable',
  Available = 'available',
}

export type ICloudAccountName =
  | { kind: ICloudAccountNameKind.Unavailable }
  | { kind: ICloudAccountNameKind.Available; value: string }

export class CloudKitAccountPresentation {
  constructor(private readonly request: CloudKitIdentity) {}
  get name(): ICloudAccountName {
    const identity = this.request

    if (identity.kind === CloudKitIdentityKind.SignedOut) {
      return { kind: ICloudAccountNameKind.Unavailable }
    }
    const given = ((v) => (v ? v : ''))(
      identity.identity.nameComponents?.givenName?.trim(),
    )
    const family = ((v) => (v ? v : ''))(
      identity.identity.nameComponents?.familyName?.trim(),
    )
    const fullName = `${given} ${family}`.trim()
    if (fullName) {
      return { kind: ICloudAccountNameKind.Available, value: fullName }
    }
    const email = identity.identity.lookupInfo?.emailAddress?.trim()
    return email
      ? { kind: ICloudAccountNameKind.Available, value: email }
      : { kind: ICloudAccountNameKind.Unavailable }
  }
}
