import { describe, expect, test } from 'bun:test'
import { AuthenticationWorkflowSnapshotIngress } from '../src/lib/auth-workflow-messages'
import {
  authenticationWorkflowMessageResponse,
  type AuthenticationWorkflowRoutingDependencies,
} from '../src/background/service-worker/authentication-workflow-routing'
import { MatchingPasskeyAvailabilityKind } from '../src/background/service-worker/passkey-availability'
import { AuthenticationWorkflowSnapshotKind } from '../src/background/vault-runtime'

const messageAdmission = AuthenticationWorkflowSnapshotIngress.admit({
  type: 'nook:authentication-workflow-snapshot',
  payload: {
    origin: 'https://login.example.test',
    observations: [
      {
        fields: {
          usernameFieldCount: 0,
          currentPasswordFieldCount: 0,
          newPasswordFieldCount: 0,
          genericPasswordFieldCount: 0,
          oneTimeCodeFieldCount: 0,
          actionablePasswordFieldCount: 0,
          readonlyPasswordFieldCount: 0,
        },
        ceremony: {
          oneTimeCodeProgression: 'advance-control-required',
          oneTimeCodeHandlerSignal: '',
          authenticationContext: {
            authenticationUsername: 'absent',
            sourceOrigin: 'https://login.example.test',
            formIdentity: 'login',
            destinationIdentity: '/login',
          },
          manualCheckpoint: 'absent',
          advanceControl: 'absent',
        },
        authenticator: {
          authenticatorSetup: 'absent',
          backupCodesCopy: '',
          passkeyControl: 'absent',
          passkeyAccountAvailability: 'unavailable',
          matchingPasskeyAccountCount: 0,
          detailedPasskeyControl: { kind: 'absent' },
        },
        credentialSubmission: { kind: 'absent' },
        detailedAdvanceControl: { kind: 'absent' },
      },
    ],
  },
})
if (messageAdmission.kind !== 'accepted') {
  throw new Error('workflow routing fixture must pass Rust admission')
}
const message = messageAdmission.message
const sender: chrome.runtime.MessageSender = {}
type WorkflowSnapshotRequest = Parameters<
  AuthenticationWorkflowRoutingDependencies['authenticationWorkflowSnapshot']
>[0]

function workflowDependencies(
  overrides: Partial<AuthenticationWorkflowRoutingDependencies>,
): AuthenticationWorkflowRoutingDependencies {
  return {
    companionWasmReady: Promise.resolve(),
    authenticationPasskeyEvidenceIsSafe: () => true,
    matchingPasskeyAvailabilityForOriginSafe: async () => ({
      kind: MatchingPasskeyAvailabilityKind.Unavailable,
    }),
    authenticationWorkflowSnapshot: async () => ({
      kind: AuthenticationWorkflowSnapshotKind.NoMatch,
    }),
    authenticationWorkflowSavedLoginCapability: () => 'unavailable',
    authenticationWorkflowRequiresLoginMatchAvailability: () => false,
    websiteLoginMatchAvailability: async () => ({ kind: 'unavailable' }),
    ...overrides,
  }
}

function matchedWorkflowSnapshot({
  observationIndex,
  action,
}: {
  observationIndex: number
  action: number
}): Awaited<
  ReturnType<
    AuthenticationWorkflowRoutingDependencies['authenticationWorkflowSnapshot']
  >
> {
  return {
    kind: AuthenticationWorkflowSnapshotKind.Matched,
    snapshot: {
      kind: 0,
      stage: 0,
      action,
      currentStep: 1,
      totalSteps: 1,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'fill-saved-login',
      observationIndex,
    },
  }
}

describe('authentication workflow routing', () => {
  test('waits for companion WASM before classifying cold-start passkey evidence', async () => {
    let resolveReady = () => {}
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const events: string[] = []
    const dependencies = workflowDependencies({
      companionWasmReady: ready,
      authenticationPasskeyEvidenceIsSafe: () => {
        events.push('evidence-classified')
        return true
      },
      matchingPasskeyAvailabilityForOriginSafe: async () => {
        events.push('passkeys-counted')
        return {
          kind: MatchingPasskeyAvailabilityKind.Ready,
          accountCount: 2,
        }
      },
      authenticationWorkflowSnapshot: async ({
        observations,
      }: WorkflowSnapshotRequest) => {
        events.push(
          `snapshot:${observations[0]?.authenticator.matchingPasskeyAccountCount}`,
        )
        return matchedWorkflowSnapshot({ observationIndex: 0, action: 0 })
      },
      authenticationWorkflowSavedLoginCapability: () => 'fill-saved-login',
      authenticationWorkflowRequiresLoginMatchAvailability: () => true,
      websiteLoginMatchAvailability: async () => ({ kind: 'ready', count: 2 }),
    })

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        sender,
        dependencies,
      }
    const response = authenticationWorkflowMessageResponse(request)
    await Promise.resolve()
    expect(events).toEqual([])

    resolveReady()
    expect(await response).toMatchObject({
      workflow: { ok: true },
      loginMatches: { kind: 'ready', count: 2 },
      selectedFacts: {
        state: 'selected',
        facts: { authenticator: { matchingPasskeyAccountCount: 2 } },
      },
    })
    expect(events).toEqual([
      'evidence-classified',
      'passkeys-counted',
      'snapshot:2',
    ])
  })

  test('bounds matching passkey account counts before classification', async () => {
    const dependencies = workflowDependencies({
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: MatchingPasskeyAvailabilityKind.Ready,
        accountCount: 101,
      }),
      authenticationWorkflowSnapshot: async ({
        observations,
      }: WorkflowSnapshotRequest) => {
        expect(observations[0]?.authenticator.matchingPasskeyAccountCount).toBe(
          100,
        )
        return { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
      },
    })

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        sender,
        dependencies,
      }
    expect(await authenticationWorkflowMessageResponse(request)).toEqual({
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'notApplicable' },
    })
  })

  test('preserves a matched workflow when optional login availability fails', async () => {
    for (const failure of ['rejected', 'timeout', 'invalid-response']) {
      const dependencies = workflowDependencies({
        matchingPasskeyAvailabilityForOriginSafe: async () => ({
          kind: MatchingPasskeyAvailabilityKind.Ready,
          accountCount: 2,
        }),
        authenticationWorkflowSnapshot: async () =>
          matchedWorkflowSnapshot({ observationIndex: 0, action: 4 }),
        authenticationWorkflowSavedLoginCapability: () => 'fill-saved-login',
        authenticationWorkflowRequiresLoginMatchAvailability: () => true,
        websiteLoginMatchAvailability: async () => {
          throw new Error(failure)
        },
      })
      const request: Parameters<
        typeof authenticationWorkflowMessageResponse
      >[0] = {
        message,
        sender,
        dependencies,
      }

      expect(
        await authenticationWorkflowMessageResponse(request),
      ).toMatchObject({
        workflow: {
          ok: true,
          snapshot: { observationIndex: 0, action: 4 },
        },
        loginMatches: { kind: 'unavailable' },
        selectedFacts: {
          state: 'selected',
          facts: { authenticator: { matchingPasskeyAccountCount: 2 } },
        },
      })
    }
  })

  test('does not probe saved-login availability for ordinary Continue workflows', async () => {
    let availabilityCalls = 0
    const dependencies = workflowDependencies({
      authenticationPasskeyEvidenceIsSafe: () => false,
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: MatchingPasskeyAvailabilityKind.Ready,
        accountCount: 0,
      }),
      authenticationWorkflowSnapshot: async () =>
        matchedWorkflowSnapshot({ observationIndex: 0, action: 0 }),
      authenticationWorkflowSavedLoginCapability: () => 'fill-saved-login',
      authenticationWorkflowRequiresLoginMatchAvailability: () => false,
      websiteLoginMatchAvailability: async () => {
        availabilityCalls += 1
        return { kind: 'ready', count: 1 }
      },
    })
    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      { message, sender, dependencies }

    expect(await authenticationWorkflowMessageResponse(request)).toMatchObject({
      workflow: { ok: true, snapshot: { action: 0 } },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'selected' },
    })
    expect(availabilityCalls).toBe(0)
  })

  test('contains a synchronous evidence-classifier exception', async () => {
    const dependencies = workflowDependencies({
      authenticationPasskeyEvidenceIsSafe: () => {
        throw new Error('WASM not initialized')
      },
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: MatchingPasskeyAvailabilityKind.Ready,
        accountCount: 0,
      }),
      authenticationWorkflowSnapshot: async () => ({
        kind: AuthenticationWorkflowSnapshotKind.NoMatch,
      }),
    })

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        sender,
        dependencies,
      }
    expect(await authenticationWorkflowMessageResponse(request)).toEqual({
      workflow: { ok: false, reason: 'workflow-snapshot-failed' },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'notApplicable' },
    })
  })

  test('preserves non-passkey classification when lookup is unavailable', async () => {
    const observedAvailability: string[] = []
    const dependencies = workflowDependencies({
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: MatchingPasskeyAvailabilityKind.Unavailable,
      }),
      authenticationWorkflowSnapshot: async ({
        observations,
      }: WorkflowSnapshotRequest) => {
        observedAvailability.push(
          ((v) => (v ? v : ''))(
            observations[0]?.authenticator.passkeyAccountAvailability,
          ),
        )
        return { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
      },
    })

    expect(
      await authenticationWorkflowMessageResponse({
        message,
        sender,
        dependencies,
      }),
    ).toEqual({
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
      selectedFacts: { state: 'notApplicable' },
    })
    expect(observedAvailability).toEqual(['unavailable'])
  })
})
