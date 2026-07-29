import type {
  ExtensionDeviceProtectionResult,
  ExtensionDeviceProtectionStatus,
} from '../lib/nook-wasm'

export enum PopupProtectionStatus {
  PinSetup = 'pin-setup',
}

export type ResolvedPopupProtectionStatus =
  | ExtensionDeviceProtectionStatus
  | PopupProtectionStatus

export enum PairingCandidateKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

export type PairingCandidate =
  | { kind: PairingCandidateKind.NotSelected }
  | {
      kind: PairingCandidateKind.Selected
      device: ExtensionDeviceProtectionResult
    }
