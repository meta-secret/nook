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
          matchingPasskeyAccountCount: 0,
        },
      },
    ],
  },
} as unknown as AuthenticationWorkflowSnapshotMessage

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
      matchingPasskeyAccountCountForOriginSafe: async () => {
        events.push('passkeys-counted')
        return 2
      },
      loginMatchAvailabilityForOriginSafe: async () => ({
        kind: 'unavailable',
      }),
      authenticationWorkflowSnapshot: async ({ observations }) => {
        events.push(
          `snapshot:${observations[0]?.authenticator.matchingPasskeyAccountCount}`,
        )
        return { kind: 'no-match' }
      },
    } as unknown as AuthenticationWorkflowRoutingDependencies

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        dependencies,
      }
    const response = authenticationWorkflowMessageResponse(request)
    await Promise.resolve()
    expect(events).toEqual([])

    resolveReady()
    await expect(response).resolves.toEqual({
      workflow: { ok: true },
      loginMatches: { kind: 'unavailable' },
    })
    expect(events).toEqual([
      'evidence-classified',
      'passkeys-counted',
      'snapshot:2',
    ])
  })

  test('contains a synchronous evidence-classifier exception', async () => {
    const dependencies = {
      companionWasmReady: Promise.resolve(),
      authenticationPasskeyEvidenceIsSafe: () => {
        throw new Error('WASM not initialized')
      },
      matchingPasskeyAccountCountForOriginSafe: async () => 0,
      loginMatchAvailabilityForOriginSafe: async () => ({
        kind: 'unavailable',
      }),
      authenticationWorkflowSnapshot: async () => ({ kind: 'no-match' }),
    } as unknown as AuthenticationWorkflowRoutingDependencies

    const request: Parameters<typeof authenticationWorkflowMessageResponse>[0] =
      {
        message,
        dependencies,
      }
    await expect(
      authenticationWorkflowMessageResponse(request),
    ).resolves.toEqual({
      ok: false,
      reason: 'workflow-snapshot-failed',
    })
  })
})
