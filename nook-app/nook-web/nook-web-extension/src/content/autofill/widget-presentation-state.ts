import { type WebsiteLoginMatchAvailability } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'

export enum PilotVaultConnectionKind {
  NotConnected = 'not-connected',
  Connected = 'connected',
}

export type PilotVaultConnection =
  | { readonly kind: PilotVaultConnectionKind.NotConnected }
  | { readonly kind: PilotVaultConnectionKind.Connected }

export enum WidgetVaultPresentationKind {
  NotConnected = 'vault-not-connected',
  Connected = 'vault-connected',
  Locked = 'vault-locked',
  NoMatchingCredential = 'no-matching-credential',
  CredentialAvailable = 'credential-available',
  Unavailable = 'unavailable',
}

export type WidgetVaultPresentation =
  | { readonly kind: WidgetVaultPresentationKind.NotConnected }
  | { readonly kind: WidgetVaultPresentationKind.Connected }
  | { readonly kind: WidgetVaultPresentationKind.Locked }
  | {
      readonly kind: WidgetVaultPresentationKind.NoMatchingCredential
      readonly count: 0
    }
  | {
      readonly kind: WidgetVaultPresentationKind.CredentialAvailable
      readonly count: number
    }
  | { readonly kind: WidgetVaultPresentationKind.Unavailable }

export type WidgetVaultPresentationProjectionArgs = {
  readonly vaultConnection: PilotVaultConnection
  readonly loginMatches: WebsiteLoginMatchAvailability
}

/** Owns the browser-facing projection of Rust login-match availability. */
export class WidgetVaultPresentationProjection {
  constructor(
    private readonly request: WidgetVaultPresentationProjectionArgs,
  ) {}

  static forConnection(
    connection: PilotVaultConnection,
  ): WidgetVaultPresentation {
    if (connection.kind === PilotVaultConnectionKind.NotConnected) {
      return { kind: WidgetVaultPresentationKind.NotConnected }
    }
    return { kind: WidgetVaultPresentationKind.Connected }
  }

  state(): WidgetVaultPresentation {
    const { vaultConnection, loginMatches } = this.request
    if (vaultConnection.kind === PilotVaultConnectionKind.NotConnected) {
      return { kind: WidgetVaultPresentationKind.NotConnected }
    }

    switch (loginMatches.kind) {
      case 'locked':
        return { kind: WidgetVaultPresentationKind.Locked }
      case 'unavailable':
        return { kind: WidgetVaultPresentationKind.Unavailable }
      case 'ready':
        return loginMatches.count === 0
          ? {
              kind: WidgetVaultPresentationKind.NoMatchingCredential,
              count: 0,
            }
          : {
              kind: WidgetVaultPresentationKind.CredentialAvailable,
              count: loginMatches.count,
            }
      default:
        return { kind: WidgetVaultPresentationKind.Unavailable }
    }
  }
}

export function savedLoginDescriptionKey(
  presentation: WidgetVaultPresentation,
): BrowserMessageKey {
  switch (presentation.kind) {
    case WidgetVaultPresentationKind.NotConnected:
      return BROWSER_MESSAGE_KEYS.WidgetConnectVault
    case WidgetVaultPresentationKind.Connected:
      return BROWSER_MESSAGE_KEYS.WidgetLoginDescription
    case WidgetVaultPresentationKind.Locked:
      return BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue
    case WidgetVaultPresentationKind.NoMatchingCredential:
      return BROWSER_MESSAGE_KEYS.WidgetLoginNoMatchDescription
    case WidgetVaultPresentationKind.CredentialAvailable:
      return presentation.count === 1
        ? BROWSER_MESSAGE_KEYS.WidgetLoginSingleDescription
        : BROWSER_MESSAGE_KEYS.WidgetLoginMultipleDescription
    case WidgetVaultPresentationKind.Unavailable:
      return BROWSER_MESSAGE_KEYS.WidgetLoginUnavailableDescription
  }
}
