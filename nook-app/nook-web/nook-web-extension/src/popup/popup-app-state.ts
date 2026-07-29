import type { ExtensionDeviceProtectionResult } from '../lib/nook-wasm'
import type { LoginDetectionStatus } from '../lib/login-detection-messages'

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

export enum LoginDetectionViewKind {
  Loading = 'loading',
  Ready = 'ready',
}

export type LoginDetectionView =
  | { kind: LoginDetectionViewKind.Loading }
  | {
      kind: LoginDetectionViewKind.Ready
      status: LoginDetectionStatus
    }
