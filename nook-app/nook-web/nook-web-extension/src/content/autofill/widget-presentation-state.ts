import { type WebsiteLoginMatchAvailability } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import {
  ExtensionSetupLoadKind,
  type ExtensionSetupLoad,
} from '../../lib/pairing-state'

export enum PilotVaultConnectionKind {
  NotConnected = 'not-connected',
  /** A keyring is connected and has no vault yet. */
  KeyringWithoutVault = 'keyring-without-vault',
  Connected = 'connected',
  Unavailable = 'unavailable',
}

export type PilotVaultConnection =
  | { readonly kind: PilotVaultConnectionKind.NotConnected }
  | { readonly kind: PilotVaultConnectionKind.KeyringWithoutVault }
  | { readonly kind: PilotVaultConnectionKind.Connected }
  | { readonly kind: PilotVaultConnectionKind.Unavailable }

export function pilotVaultConnectionFromSetupState(
  setup: ExtensionSetupLoad,
): PilotVaultConnection {
  switch (setup.kind) {
    case ExtensionSetupLoadKind.Ready:
      return { kind: PilotVaultConnectionKind.Connected }
    case ExtensionSetupLoadKind.NotConnected:
      return { kind: PilotVaultConnectionKind.NotConnected }
    case ExtensionSetupLoadKind.KeyringWithoutVault:
      return { kind: PilotVaultConnectionKind.KeyringWithoutVault }
    case ExtensionSetupLoadKind.Unavailable:
      return { kind: PilotVaultConnectionKind.Unavailable }
  }
}

export enum WidgetVaultPresentationKind {
  NotConnected = 'vault-not-connected',
  /** Nook is connected through a keyring that has no vault yet. */
  NoVault = 'no-vault',
  Connected = 'vault-connected',
  Locked = 'vault-locked',
  NoMatchingCredential = 'no-matching-credential',
  CredentialAvailable = 'credential-available',
  Unavailable = 'unavailable',
}

export type WidgetVaultPresentation =
  | { readonly kind: WidgetVaultPresentationKind.NotConnected }
  | { readonly kind: WidgetVaultPresentationKind.NoVault }
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

export enum SavedLoginPresentationKind {
  Workflow = 'workflow',
  Empty = 'empty',
}

/** Chooses the saved-login surface from the already resolved vault outcome. */
export class SavedLoginPresentation {
  static forVault(
    presentation: WidgetVaultPresentation,
  ): SavedLoginPresentationKind {
    switch (presentation.kind) {
      case WidgetVaultPresentationKind.NoMatchingCredential:
        return SavedLoginPresentationKind.Empty
      case WidgetVaultPresentationKind.NotConnected:
      case WidgetVaultPresentationKind.NoVault:
      case WidgetVaultPresentationKind.Connected:
      case WidgetVaultPresentationKind.Locked:
      case WidgetVaultPresentationKind.CredentialAvailable:
      case WidgetVaultPresentationKind.Unavailable:
        return SavedLoginPresentationKind.Workflow
    }
  }
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
    switch (connection.kind) {
      case PilotVaultConnectionKind.NotConnected:
        return { kind: WidgetVaultPresentationKind.NotConnected }
      case PilotVaultConnectionKind.KeyringWithoutVault:
        return { kind: WidgetVaultPresentationKind.NoVault }
      case PilotVaultConnectionKind.Unavailable:
        return { kind: WidgetVaultPresentationKind.Unavailable }
      case PilotVaultConnectionKind.Connected:
        return { kind: WidgetVaultPresentationKind.Connected }
    }
  }

  state(): WidgetVaultPresentation {
    const { vaultConnection, loginMatches } = this.request
    switch (vaultConnection.kind) {
      case PilotVaultConnectionKind.NotConnected:
        return { kind: WidgetVaultPresentationKind.NotConnected }
      case PilotVaultConnectionKind.KeyringWithoutVault:
        return { kind: WidgetVaultPresentationKind.NoVault }
      case PilotVaultConnectionKind.Unavailable:
        return { kind: WidgetVaultPresentationKind.Unavailable }
      case PilotVaultConnectionKind.Connected:
        break
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
      return BROWSER_MESSAGE_KEYS.WidgetConnectFirstDescription
    case WidgetVaultPresentationKind.NoVault:
      return BROWSER_MESSAGE_KEYS.WidgetNoVaultDescription
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

/** Whether a widget action reads or writes the connected vault. */
export enum WidgetVaultRequirement {
  Required = 'required',
  NotRequired = 'not-required',
}

/** What the widget offers before an action that needs the vault. */
export enum WidgetVaultGateKind {
  /** No vault is connected: offer Connect vault, never the blocked action. */
  Connect = 'connect',
  /** A keyring is connected with no vault yet: offer Open vault to create
   * one, never Connect vault or the blocked action. */
  CreateVault = 'create-vault',
  /** The connected vault is locked: offer Unlock, never the blocked action. */
  Unlock = 'unlock',
  /** The action can run: offer it. */
  Open = 'open',
}

export type WidgetVaultGateRequest = {
  readonly presentation: WidgetVaultPresentation
  readonly requirement: WidgetVaultRequirement
}

/**
 * The one place that decides whether a widget may offer its vault action.
 * Every widget flow asks it before wiring its primary action, so no flow
 * offers Sign in, fill, save, passkey or authenticator actions that the
 * current vault connection cannot complete.
 */
export class WidgetVaultGate {
  static decide(request: WidgetVaultGateRequest): WidgetVaultGateKind {
    switch (request.requirement) {
      case WidgetVaultRequirement.NotRequired:
        return WidgetVaultGateKind.Open
      case WidgetVaultRequirement.Required:
        break
    }
    switch (request.presentation.kind) {
      case WidgetVaultPresentationKind.NotConnected:
        return WidgetVaultGateKind.Connect
      case WidgetVaultPresentationKind.NoVault:
        return WidgetVaultGateKind.CreateVault
      case WidgetVaultPresentationKind.Locked:
        return WidgetVaultGateKind.Unlock
      case WidgetVaultPresentationKind.Connected:
      case WidgetVaultPresentationKind.NoMatchingCredential:
      case WidgetVaultPresentationKind.CredentialAvailable:
      case WidgetVaultPresentationKind.Unavailable:
        return WidgetVaultGateKind.Open
    }
  }
}
