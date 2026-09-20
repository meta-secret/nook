import { type WebsiteLoginMatchAvailability } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum PilotVaultConnectionKind {
  NotConnected = 'not-connected',
  Connected = 'connected',
}

export type PilotVaultConnection =
  | { readonly kind: PilotVaultConnectionKind.NotConnected }
  | {
      readonly kind: PilotVaultConnectionKind.Connected
      readonly vaultName: string
    }

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
  | {
      readonly kind: WidgetVaultPresentationKind.Connected
      readonly vaultName: string
    }
  | {
      readonly kind: WidgetVaultPresentationKind.Locked
      readonly vaultName: string
    }
  | {
      readonly kind: WidgetVaultPresentationKind.NoMatchingCredential
      readonly vaultName: string
    }
  | {
      readonly kind: WidgetVaultPresentationKind.CredentialAvailable
      readonly vaultName: string
    }
  | {
      readonly kind: WidgetVaultPresentationKind.Unavailable
      readonly vaultName: string
    }

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
    return {
      kind: WidgetVaultPresentationKind.Connected,
      vaultName: connection.vaultName,
    }
  }

  state(): WidgetVaultPresentation {
    const { vaultConnection, loginMatches } = this.request
    if (vaultConnection.kind === PilotVaultConnectionKind.NotConnected) {
      return { kind: WidgetVaultPresentationKind.NotConnected }
    }

    switch (loginMatches.kind) {
      case 'locked':
        return {
          kind: WidgetVaultPresentationKind.Locked,
          vaultName: vaultConnection.vaultName,
        }
      case 'unavailable':
        return {
          kind: WidgetVaultPresentationKind.Unavailable,
          vaultName: vaultConnection.vaultName,
        }
      case 'ready':
        return loginMatches.count === 0
          ? {
              kind: WidgetVaultPresentationKind.NoMatchingCredential,
              vaultName: vaultConnection.vaultName,
            }
          : {
              kind: WidgetVaultPresentationKind.CredentialAvailable,
              vaultName: vaultConnection.vaultName,
            }
      default:
        return {
          kind: WidgetVaultPresentationKind.Unavailable,
          vaultName: vaultConnection.vaultName,
        }
    }
  }
}
