import {
  authentication_passkey_control_evidence_is_safe,
  authentication_workflow_saved_login_capability,
  authentication_workflow_requires_login_match_availability,
  type AuthenticationSavedLoginCapability,
  type AuthenticationDetailedPasskeyControlObservation,
  type WebsiteLoginMatchAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import type {
  AuthenticationPageObservationView,
  AuthenticationWorkflowSnapshotMessage,
  AuthenticationWorkflowSnapshotView,
} from '../../lib/auth-workflow-messages'
import type * as PasskeyOperations from './passkey-operations'
import type * as AccountPickers from './account-pickers'
import type * as VaultRuntime from '../vault-runtime'

export type AuthenticationWorkflowRoutingDependencies = {
  companionWasmReady: Promise<void>
  authenticationPasskeyEvidenceIsSafe: typeof authenticationPasskeyEvidenceIsSafe
  authenticationWorkflowSnapshot: typeof VaultRuntime.authenticationWorkflowSnapshot
  authenticationWorkflowSavedLoginCapability: typeof authenticationWorkflowSavedLoginCapability
  authenticationWorkflowRequiresLoginMatchAvailability: typeof authenticationWorkflowRequiresLoginMatchAvailability
  matchingPasskeyAccountCountForOriginSafe: typeof PasskeyOperations.matchingPasskeyAccountCountForOriginSafe
  websiteLoginMatchAvailability: typeof AccountPickers.websiteLoginMatchAvailability
}

export function authenticationPasskeyEvidenceIsSafe(
  evidence: AuthenticationDetailedPasskeyControlObservation,
): boolean {
  return authentication_passkey_control_evidence_is_safe(evidence)
}

export function authenticationWorkflowSavedLoginCapability(
  snapshot: AuthenticationWorkflowSnapshotView,
): AuthenticationSavedLoginCapability {
  return authentication_workflow_saved_login_capability(snapshot)
}

export function authenticationWorkflowRequiresLoginMatchAvailability(
  snapshot: AuthenticationWorkflowSnapshotView,
): boolean {
  return authentication_workflow_requires_login_match_availability(snapshot)
}

export type AuthenticationWorkflowRoutingResponse = {
  workflow:
    | { ok: true; snapshot?: AuthenticationWorkflowSnapshotView }
    | { ok: false; reason: 'workflow-snapshot-failed' }
  loginMatches: WebsiteLoginMatchAvailability
  selectedFacts?: AuthenticationPageObservationView
}

export type AuthenticationWorkflowRoutingRequest = {
  message: AuthenticationWorkflowSnapshotMessage
  sender: chrome.runtime.MessageSender
  dependencies: AuthenticationWorkflowRoutingDependencies
}

export async function authenticationWorkflowMessageResponse({
  message,
  sender,
  dependencies,
}: AuthenticationWorkflowRoutingRequest): Promise<AuthenticationWorkflowRoutingResponse> {
  const {
    companionWasmReady,
    authenticationPasskeyEvidenceIsSafe,
    authenticationWorkflowSnapshot,
    authenticationWorkflowSavedLoginCapability,
    authenticationWorkflowRequiresLoginMatchAvailability,
    matchingPasskeyAccountCountForOriginSafe,
    websiteLoginMatchAvailability,
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
      const capability = authenticationWorkflowSavedLoginCapability(
        result.snapshot,
      )
      let loginMatches: WebsiteLoginMatchAvailability = {
        kind: 'unavailable',
      }
      if (
        capability === 'fill-saved-login' &&
        authenticationWorkflowRequiresLoginMatchAvailability(result.snapshot)
      ) {
        try {
          const availabilityRequest: Parameters<
            typeof websiteLoginMatchAvailability
          >[0] = {
            origin: message.payload.origin,
            sender,
          }
          loginMatches =
            await websiteLoginMatchAvailability(availabilityRequest)
        } catch {
          loginMatches = { kind: 'unavailable' }
        }
      }
      return {
        workflow: { ok: true, snapshot: result.snapshot },
        loginMatches,
        selectedFacts,
      }
    }
    return {
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
    }
  } catch {
    return {
      workflow: { ok: false, reason: 'workflow-snapshot-failed' },
      loginMatches: { kind: 'unavailable' },
    }
  }
}
