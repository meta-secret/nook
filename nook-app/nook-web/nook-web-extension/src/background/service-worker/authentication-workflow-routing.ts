import {
  authentication_passkey_control_evidence_is_safe,
  type AuthenticationDetailedPasskeyControlObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import type {
  AuthenticationPageObservationView,
  AuthenticationWorkflowSnapshotMessage,
  AuthenticationWorkflowSnapshotView,
} from '../../lib/auth-workflow-messages'
import type * as PasskeyOperations from './passkey-operations'
import type * as VaultRuntime from '../vault-runtime'

export type AuthenticationWorkflowRoutingDependencies = {
  companionWasmReady: Promise<void>
  authenticationPasskeyEvidenceIsSafe: typeof authenticationPasskeyEvidenceIsSafe
  authenticationWorkflowSnapshot: typeof VaultRuntime.authenticationWorkflowSnapshot
  matchingPasskeyAccountCountForOriginSafe: typeof PasskeyOperations.matchingPasskeyAccountCountForOriginSafe
}

export function authenticationPasskeyEvidenceIsSafe(
  evidence: AuthenticationDetailedPasskeyControlObservation,
): boolean {
  return authentication_passkey_control_evidence_is_safe(evidence)
}

export type AuthenticationWorkflowRoutingResponse =
  | {
      ok: true
      snapshot?: AuthenticationWorkflowSnapshotView
      selectedFacts?: AuthenticationPageObservationView
    }
  | { ok: false; reason: 'workflow-snapshot-failed' }

export type AuthenticationWorkflowRoutingRequest = {
  message: AuthenticationWorkflowSnapshotMessage
  dependencies: AuthenticationWorkflowRoutingDependencies
}

export async function authenticationWorkflowMessageResponse({
  message,
  dependencies,
}: AuthenticationWorkflowRoutingRequest): Promise<AuthenticationWorkflowRoutingResponse> {
  const {
    companionWasmReady,
    authenticationPasskeyEvidenceIsSafe,
    authenticationWorkflowSnapshot,
    matchingPasskeyAccountCountForOriginSafe,
  } = dependencies
  try {
    await companionWasmReady
    const passkeyEvidenceIsSafe = message.payload.observations.map(
      (observation) => {
        const evidence = observation.authenticator.detailedPasskeyControl
        return evidence ? authenticationPasskeyEvidenceIsSafe(evidence) : false
      },
    )
    const needsPasskeyLookup = passkeyEvidenceIsSafe.some(Boolean)
    const matchingPasskeyAccountCount = needsPasskeyLookup
      ? await matchingPasskeyAccountCountForOriginSafe(message.payload.origin)
      : 0
    const observations = Array.from(message.payload.observations.entries()).map(
      ([observationIndex, observation]) => ({
        ...observation,
        authenticator: {
          ...observation.authenticator,
          matchingPasskeyAccountCount:
            passkeyEvidenceIsSafe[observationIndex] === true
              ? Math.min(
                  matchingPasskeyAccountCount,
                  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
                )
              : 0,
        },
      }),
    )
    const snapshotRequest: Parameters<
      typeof authenticationWorkflowSnapshot
    >[0] = {
      observations,
    }
    const result = await authenticationWorkflowSnapshot(snapshotRequest)
    if ('snapshot' in result) {
      const selectedFacts = observations[result.snapshot.observationIndex]
      if (!selectedFacts) {
        throw new Error('selected authentication workflow facts were absent')
      }
      return { ok: true, snapshot: result.snapshot, selectedFacts }
    }
    return {
      ok: true,
    }
  } catch {
    return { ok: false, reason: 'workflow-snapshot-failed' }
  }
}
