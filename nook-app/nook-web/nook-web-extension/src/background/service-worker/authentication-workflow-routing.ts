import {
  authentication_passkey_control_evidence_is_safe,
  authentication_workflow_saved_login_capability,
  authentication_workflow_requires_login_match_availability,
  authentication_workflow_pilot_presentation_capability,
  bind_authentication_page_observation_facts,
  saved_login_action_available,
  type AuthenticationPageObservationFacts,
  type AuthenticationSavedLoginCapability,
  type AuthenticationDetailedPasskeyControlObservation,
  type AuthenticationPilotPresentationCapability,
  type AuthenticationObservationBindingToken,
  type AuthenticationWorkflowSelectedFactsWire,
  type WebsiteLoginMatchAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import type {
  AuthenticationWorkflowSnapshotMessage,
  AuthenticationWorkflowSnapshotView,
} from '../../lib/auth-workflow-messages'
import type * as AccountPickers from './account-pickers'
import {
  type MatchingPasskeyAvailability,
  MatchingPasskeyAvailabilityKind,
  passkeyAccountCountForClassification,
} from './passkey-availability'
import type { websitePasskeyRequests } from './passkey-operations'
import type * as VaultRuntime from '../vault-runtime'

export type AuthenticationWorkflowRoutingDependencies = {
  companionWasmReady: Promise<void>
  authenticationPasskeyEvidenceIsSafe: typeof authenticationPasskeyEvidenceIsSafe
  authenticationWorkflowSnapshot: typeof VaultRuntime.backgroundVaultRuntime.authenticationWorkflowSnapshot
  authenticationWorkflowSavedLoginCapability: typeof authenticationWorkflowSavedLoginCapability
  authenticationWorkflowRequiresLoginMatchAvailability: typeof authenticationWorkflowRequiresLoginMatchAvailability
  authenticationWorkflowPilotPresentationCapability?: typeof authenticationWorkflowPilotPresentationCapability
  bindAuthenticationPageObservationFacts?: typeof bind_authentication_page_observation_facts
  savedLoginActionAvailable?: typeof saved_login_action_available
  matchingPasskeyAvailabilityForOriginSafe: typeof websitePasskeyRequests.matchingPasskeyAvailabilityForOriginSafe
  websiteLoginMatchAvailability: typeof AccountPickers.accountPickerSessions.websiteLoginMatchAvailability
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

export function authenticationWorkflowPilotPresentationCapability(
  snapshot: AuthenticationWorkflowSnapshotView,
): AuthenticationPilotPresentationCapability {
  return authentication_workflow_pilot_presentation_capability(snapshot)
}

export type AuthenticationWorkflowRoutingResponse = {
  workflow:
    | { ok: true; snapshot?: AuthenticationWorkflowSnapshotView }
    | { ok: false; reason: 'workflow-snapshot-failed' }
  loginMatches: WebsiteLoginMatchAvailability
  selectedFacts: AuthenticationWorkflowSelectedFactsWire
  pilotCapability?: AuthenticationPilotPresentationCapability
  factsBindingToken?: AuthenticationObservationBindingToken
  savedLoginActionAvailable?: boolean
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
    matchingPasskeyAvailabilityForOriginSafe,
    websiteLoginMatchAvailability,
  } = dependencies
  const pilotPresentationCapability =
    dependencies.authenticationWorkflowPilotPresentationCapability ??
    authenticationWorkflowPilotPresentationCapability
  const bindFacts =
    dependencies.bindAuthenticationPageObservationFacts ??
    bind_authentication_page_observation_facts
  const savedLoginAvailable =
    dependencies.savedLoginActionAvailable ?? saved_login_action_available
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
    const passkeyAccountCountArgs: Parameters<
      typeof passkeyAccountCountForClassification
    >[0] = {
      needsPasskeyLookup,
      availability: passkeyAvailability,
    }
    const matchingPasskeyAccountCount = passkeyAccountCountForClassification(
      passkeyAccountCountArgs,
    )
    const observations: AuthenticationPageObservationFacts[] = Array.from(
      message.payload.observations.entries(),
      ([observationIndex, observation]) => ({
        ...observation,
        authenticator: {
          ...observation.authenticator,
          passkeyAccountAvailability:
            passkeyEvidenceIsSafe[observationIndex] === true &&
            passkeyAvailability.kind ===
              MatchingPasskeyAvailabilityKind.Unavailable
              ? 'unavailable'
              : 'ready',
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
        selectedFacts: { state: 'selected', facts: selectedFacts },
        pilotCapability: pilotPresentationCapability(result.snapshot),
        factsBindingToken: bindFacts({ observations: [selectedFacts] }),
        savedLoginActionAvailable: savedLoginAvailable({
          action: result.snapshot.action,
          loginMatches,
        }),
      }
    }
    return {
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'notApplicable' },
    }
  } catch {
    return {
      workflow: { ok: false, reason: 'workflow-snapshot-failed' },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'notApplicable' },
    }
  }
}
