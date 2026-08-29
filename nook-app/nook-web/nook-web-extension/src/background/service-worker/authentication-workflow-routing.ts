import {
  authentication_passkey_control_evidence_is_safe,
  authentication_workflow_saved_login_capability,
  type AuthenticationSavedLoginCapability,
  type AuthenticationDetailedPasskeyControlObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  AuthenticationWorkflowSnapshotMessage,
  AuthenticationWorkflowSnapshotView,
  WebsiteLoginMatchAvailabilityWire,
} from '../../lib/auth-workflow-messages'
import type * as AccountPickers from './account-pickers'
import {
  type MatchingPasskeyAvailability,
  MatchingPasskeyAvailabilityKind,
  type matchingPasskeyAvailabilityForOriginSafe,
  passkeyAccountCountForClassification,
} from './passkey-operations'
import {
  AuthenticationWorkflowSnapshotKind,
  type authenticationWorkflowSnapshot,
} from '../vault-runtime'

export type AuthenticationWorkflowRoutingDependencies = {
  companionWasmReady: Promise<void>
  authenticationPasskeyEvidenceIsSafe: typeof authenticationPasskeyEvidenceIsSafe
  authenticationWorkflowSnapshot: typeof authenticationWorkflowSnapshot
  loginMatchAvailabilityForOriginSafe: typeof AccountPickers.loginMatchAvailabilityForOriginSafe
  matchingPasskeyAvailabilityForOriginSafe: typeof matchingPasskeyAvailabilityForOriginSafe
}

export function authenticationPasskeyEvidenceIsSafe(
  evidence: AuthenticationDetailedPasskeyControlObservation,
): boolean {
  return authentication_passkey_control_evidence_is_safe(evidence)
}

export type AuthenticationWorkflowRoutingResponse =
  | {
      workflow: { ok: true; snapshot?: AuthenticationWorkflowSnapshotView }
      loginMatches: WebsiteLoginMatchAvailabilityWire
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
    loginMatchAvailabilityForOriginSafe,
    matchingPasskeyAvailabilityForOriginSafe,
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
    const passkeyLookupNotRequired: MatchingPasskeyAvailability = {
      kind: MatchingPasskeyAvailabilityKind.Ready,
      accountCount: 0,
    }
    const passkeyAvailability = needsPasskeyLookup
      ? await matchingPasskeyAvailabilityForOriginSafe(message.payload.origin)
      : passkeyLookupNotRequired
    const matchingPasskeyAccountCount = passkeyAccountCountForClassification({
      needsPasskeyLookup,
      availability: passkeyAvailability,
    })
    const observations = Array.from(message.payload.observations.entries()).map(
      ([observationIndex, observation]) => ({
        ...observation,
        authenticator: {
          ...observation.authenticator,
          matchingPasskeyAccountCount:
            passkeyEvidenceIsSafe[observationIndex] === true
              ? matchingPasskeyAccountCount
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
    const savedLoginCapability =
      result.kind === AuthenticationWorkflowSnapshotKind.Matched
        ? authentication_workflow_saved_login_capability(result.snapshot)
        : ('unavailable' satisfies AuthenticationSavedLoginCapability)
    const loginMatches: WebsiteLoginMatchAvailabilityWire =
      savedLoginCapability ===
      ('fill-saved-login' satisfies AuthenticationSavedLoginCapability)
        ? await loginMatchAvailabilityForOriginSafe(message.payload.origin)
        : { kind: 'unavailable' }
    return {
      workflow: {
        ok: true,
        ...('snapshot' in result ? { snapshot: result.snapshot } : {}),
      },
      loginMatches,
    }
  } catch {
    return { ok: false, reason: 'workflow-snapshot-failed' }
  }
}
