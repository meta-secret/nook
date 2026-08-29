import type { ExtensionDeviceProtectionResult } from '../lib/nook-wasm'

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
