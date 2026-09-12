import type {
  CredentialFillObservations,
  CredentialFillPlan,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum CredentialFillHandlePhase {
  Owned = 'owned',
  Consumed = 'consumed',
}

export type CredentialFillObservationLifetime =
  | {
      readonly kind: CredentialFillHandlePhase.Owned
      readonly handle: CredentialFillObservations
    }
  | { readonly kind: CredentialFillHandlePhase.Consumed }

export type CredentialFillPlanLifetime =
  | {
      readonly kind: CredentialFillHandlePhase.Owned
      readonly handle: CredentialFillPlan
    }
  | { readonly kind: CredentialFillHandlePhase.Consumed }
