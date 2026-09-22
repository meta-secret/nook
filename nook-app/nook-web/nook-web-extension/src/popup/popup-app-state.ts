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

export enum CompanionSecretCountKind {
  Unavailable = 'unavailable',
  Loading = 'loading',
  Available = 'available',
}

export type CompanionSecretCount =
  | { kind: CompanionSecretCountKind.Unavailable }
  | { kind: CompanionSecretCountKind.Loading }
  | { kind: CompanionSecretCountKind.Available; count: number }
