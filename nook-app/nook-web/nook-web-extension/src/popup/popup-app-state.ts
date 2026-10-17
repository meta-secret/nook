import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
import type { ExtensionSessionDeviceWire } from '../lib/nook-wasm'

export enum PairingCandidateKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

export type PairingCandidate =
  | { kind: PairingCandidateKind.NotSelected }
  | {
      kind: PairingCandidateKind.Selected
      device: ExtensionSessionDeviceWire
    }

/** The unlocked identity, checked for vaults it gained since. */
export enum IdentitySyncKind {
  Idle = 'idle',
  Checking = 'checking',
  Checked = 'checked',
  /** The refresh failed; nothing further was paired. */
  Failed = 'failed',
}

export type IdentitySync =
  | { kind: IdentitySyncKind.Idle }
  | { kind: IdentitySyncKind.Checking }
  | { kind: IdentitySyncKind.Checked; awaitingGrant: number }
  | { kind: IdentitySyncKind.Failed }

/** What follows a successful passkey or PIN step in the popup. */
export enum DeviceActionFollowUp {
  /** Show the vaults. */
  Menu = 'menu',
  /** The extension just unlocked: pair the vaults its identity gained. */
  RefreshIdentity = 'refresh-identity',
}

export enum CompanionSecretCountKind {
  Unavailable = 'unavailable',
  Loading = 'loading',
  Available = 'available',
}

export type CompanionSecretCount =
  | { kind: CompanionSecretCountKind.Unavailable }
  | { kind: CompanionSecretCountKind.Loading }
  | { kind: CompanionSecretCountKind.Available; count: number }

export enum PopupInitializationPhase {
  PairingState = 'pairing-state',
  DeviceProtectionStatus = 'device-protection-status',
  ActiveSessionDevice = 'active-session-device',
  AppMount = 'app-mount',
}

export function popupInitializationFailureKey(phase: PopupInitializationPhase) {
  switch (phase) {
    case PopupInitializationPhase.PairingState:
      return I18N_KEYS.ExtensionPopupInitializationPairingStateFailed
    case PopupInitializationPhase.DeviceProtectionStatus:
      return I18N_KEYS.ExtensionPopupInitializationDeviceStatusFailed
    case PopupInitializationPhase.ActiveSessionDevice:
      return I18N_KEYS.ExtensionPopupInitializationSessionDeviceFailed
    case PopupInitializationPhase.AppMount:
      return I18N_KEYS.ExtensionPopupInitializationAppMountFailed
  }
}
