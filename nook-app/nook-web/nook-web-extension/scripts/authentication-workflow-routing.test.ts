import { describe, expect, test } from 'bun:test'
import type { AuthenticationWorkflowSnapshotMessage } from '../src/lib/auth-workflow-messages'
import {
  authenticationWorkflowMessageResponse,
  type AuthenticationWorkflowRoutingDependencies,
} from '../src/background/service-worker/authentication-workflow-routing'

const message = {
  type: 'nook:authentication-workflow-snapshot',
  payload: {
    origin: 'https://login.example.test',
    observations: [
      {
        authenticator: {
          detailedPasskeyControl: { control: 'candidate' },
          passkeyAccountAvailability: 'unavailable',
          matchingPasskeyAccountCount: 0,
        },
      },
    ],
  },
} as unknown as AuthenticationWorkflowSnapshotMessage
const sender = {} as chrome.runtime.MessageSender

describe('authentication workflow routing', () => {
  test('waits for companion WASM before classifying cold-start passkey evidence', async () => {
    let resolveReady = () => {}
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const events: string[] = []
    const dependencies = {
      companionWasmReady: ready,
      authenticationPasskeyEvidenceIsSafe: () => {
        events.push('evidence-classified')
        return true
      },
      matchingPasskeyAvailabilityForOriginSafe: async () => {
        events.push('passkeys-counted')
        return { kind: 'ready', accountCount: 2 }
      },
      authenticationWorkflowSnapshot: async ({ observations }) => {
        events.push(
          `snapshot:${observations[0]?.authenticator.matchingPasskeyAccountCount}`,
        )
        return { kind: 'matched', snapshot: { observationIndex: 0 } }
      },
      authenticationWorkflowSavedLoginCapability: () => 'fill-saved-login',
      authenticationWorkflowRequiresLoginMatchAvailability: () => true,
      websiteLoginMatchAvailability: async () => ({ kind: 'ready', count: 2 }),
    } as unknown as AuthenticationWorkflowRoutingDependencies

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
    await expect(response).resolves.toMatchObject({
      workflow: { ok: true },
      loginMatches: { kind: 'ready', count: 2 },
      selectedFacts: {
        authenticator: { matchingPasskeyAccountCount: 2 },
      },
    })
    expect(events).toEqual([
      'evidence-classified',
      'passkeys-counted',
      'snapshot:2',
    ])
  })

  test('bounds matching passkey account counts before classification', async () => {
    const dependencies = {
      companionWasmReady: Promise.resolve(),
      authenticationPasskeyEvidenceIsSafe: () => true,
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: 'ready',
        accountCount: 101,
      }),
      authenticationWorkflowSnapshot: async ({ observations }) => {
        expect(observations[0]?.authenticator.matchingPasskeyAccountCount).toBe(
          100,
        )
        return { kind: 'no-match' }
      },
      authenticationWorkflowSavedLoginCapability: () => 'unavailable',
      websiteLoginMatchAvailability: async () => ({ kind: 'unavailable' }),
    } as unknown as AuthenticationWorkflowRoutingDependencies

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        sender,
        dependencies,
      }
    await expect(
      authenticationWorkflowMessageResponse(request),
    ).resolves.toEqual({
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
    })
  })

  test('preserves a matched workflow when optional login availability fails', async () => {
    for (const failure of ['rejected', 'timeout', 'invalid-response']) {
      const dependencies = {
        companionWasmReady: Promise.resolve(),
        authenticationPasskeyEvidenceIsSafe: () => true,
        matchingPasskeyAvailabilityForOriginSafe: async () => ({
          kind: 'ready',
          accountCount: 2,
        }),
        authenticationWorkflowSnapshot: async () => ({
          kind: 'matched',
          snapshot: { observationIndex: 0, action: 4 },
        }),
        authenticationWorkflowSavedLoginCapability: () => 'fill-saved-login',
        authenticationWorkflowRequiresLoginMatchAvailability: () => true,
        websiteLoginMatchAvailability: async () => {
          throw new Error(failure)
        },
      } as AuthenticationWorkflowRoutingDependencies
      const request: Parameters<
        typeof authenticationWorkflowMessageResponse
      >[0] = {
        message,
        sender,
        dependencies,
      }

      await expect(
        authenticationWorkflowMessageResponse(request),
      ).resolves.toMatchObject({
        workflow: {
          ok: true,
          snapshot: { observationIndex: 0, action: 4 },
        },
        loginMatches: { kind: 'unavailable' },
        selectedFacts: {
          authenticator: { matchingPasskeyAccountCount: 2 },
        },
      })
    }
  })

  test('does not probe saved-login availability for ordinary Continue workflows', async () => {
    let availabilityCalls = 0
    const dependencies = {
      companionWasmReady: Promise.resolve(),
      authenticationPasskeyEvidenceIsSafe: () => false,
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: 'ready',
        accountCount: 0,
      }),
      authenticationWorkflowSnapshot: async () => ({
        kind: 'matched',
        snapshot: { observationIndex: 0, action: 0 },
      }),
      authenticationWorkflowSavedLoginCapability: () => 'fill-saved-login',
      authenticationWorkflowRequiresLoginMatchAvailability: () => false,
      websiteLoginMatchAvailability: async () => {
        availabilityCalls += 1
        return { kind: 'ready', count: 1 }
      },
    } as AuthenticationWorkflowRoutingDependencies
    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      { message, sender, dependencies }

    await expect(
      authenticationWorkflowMessageResponse(request),
    ).resolves.toMatchObject({
      workflow: { ok: true, snapshot: { action: 0 } },
      loginMatches: { kind: 'unavailable' },
    })
    expect(availabilityCalls).toBe(0)
  })

  test('contains a synchronous evidence-classifier exception', async () => {
    const dependencies = {
      companionWasmReady: Promise.resolve(),
      authenticationPasskeyEvidenceIsSafe: () => {
        throw new Error('WASM not initialized')
      },
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: 'ready',
        accountCount: 0,
      }),
      authenticationWorkflowSnapshot: async () => ({ kind: 'no-match' }),
      authenticationWorkflowSavedLoginCapability: () => 'unavailable',
      websiteLoginMatchAvailability: async () => ({ kind: 'unavailable' }),
    } as unknown as AuthenticationWorkflowRoutingDependencies

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        sender,
        dependencies,
      }
    await expect(
      authenticationWorkflowMessageResponse(request),
    ).resolves.toEqual({
      workflow: { ok: false, reason: 'workflow-snapshot-failed' },
      loginMatches: { kind: 'unavailable' },
    })
  })

  test('preserves non-passkey classification when lookup is unavailable', async () => {
    const observedAvailability: string[] = []
    const dependencies = {
      companionWasmReady: Promise.resolve(),
      authenticationPasskeyEvidenceIsSafe: () => true,
      matchingPasskeyAvailabilityForOriginSafe: async () => ({
        kind: 'unavailable',
      }),
      authenticationWorkflowSnapshot: async ({ observations }) => {
        observedAvailability.push(
          observations[0]?.authenticator.passkeyAccountAvailability ?? '',
        )
        return { kind: 'no-match' }
      },
    } as unknown as AuthenticationWorkflowRoutingDependencies

    await expect(
      authenticationWorkflowMessageResponse({ message, sender, dependencies }),
    ).resolves.toEqual({
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
    })
    expect(observedAvailability).toEqual(['unavailable'])
  })
})
