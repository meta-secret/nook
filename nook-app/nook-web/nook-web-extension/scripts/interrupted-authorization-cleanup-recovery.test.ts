import { describe, expect, mock, test } from 'bun:test'
import { err } from 'neverthrow'
import { Effect, Either } from 'effect'
import {
  AccountPickerAuthorizationLifecycle,
  CleanupEvidence,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { AccountPickerCleanupMarkerStatus } from '../src/background/service-worker/account-pickers'
import {
  AuthorizationCleanupFailureKind,
  recoverInterruptedAuthorizationCleanup,
} from '../src/background/service-worker/extension-lifecycle-routing'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'

await companionWasmReady
const startedCleanup = new AccountPickerAuthorizationLifecycle('opening')
  .begin_cleanup('cleanup')
  .into_lifecycle()
const rejectedCleanup = startedCleanup
  .complete_cleanup('stale', CleanupEvidence.Full)
  .outcome()

type InterruptedAuthorizationCleanupRecoveryDependencies = Parameters<
  typeof recoverInterruptedAuthorizationCleanup
>[0]

const baseDependencies: InterruptedAuthorizationCleanupRecoveryDependencies = {
  accountPickerAuthorizationCleanupPending: () => Promise.resolve(false),
  beginAccountPickerAuthorizationCleanup: () =>
    Promise.resolve({
      authorizationGeneration: 'epoch-1',
      markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
    }),
  clearPendingAccountPickers: () => Promise.resolve(),
  clearStagedAuthenticatorEnrollments: () => {},
  closeExtensionSessionDocument: () =>
    Promise.resolve(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.ClosureFailed,
        ),
      ),
    ),
  completeAccountPickerAuthorizationCleanup: () =>
    Promise.resolve(rejectedCleanup),
  releaseAccountPickerAuthorizationCleanup: () => {},
}

describe('interrupted authorization cleanup recovery', () => {
  test('invalidates authorization before reporting a failed marker lookup', async () => {
    const events: string[] = []
    const dependencies: InterruptedAuthorizationCleanupRecoveryDependencies = {
      ...baseDependencies,
      accountPickerAuthorizationCleanupPending: () => {
        events.push('marker-read-started')
        return Promise.reject(new Error('session storage unavailable'))
      },
      beginAccountPickerAuthorizationCleanup: () => {
        events.push('authorization-invalidated')
        return Promise.resolve({
          authorizationGeneration: 'epoch-13',
          markerStatus: AccountPickerCleanupMarkerStatus.Unavailable,
        })
      },
    }

    expect(
      await Effect.runPromise(
        Effect.either(recoverInterruptedAuthorizationCleanup(dependencies)),
      ),
    ).toEqual(Either.left([AuthorizationCleanupFailureKind.MarkerLookupFailed]))
    expect(events).toEqual(['marker-read-started', 'authorization-invalidated'])
  })

  test('returns a typed failure when authorization invalidation rejects', async () => {
    const dependencies: InterruptedAuthorizationCleanupRecoveryDependencies = {
      ...baseDependencies,
      beginAccountPickerAuthorizationCleanup: () =>
        Promise.reject(new Error('authorization cleanup unavailable')),
    }

    expect(
      await Effect.runPromise(
        Effect.either(recoverInterruptedAuthorizationCleanup(dependencies)),
      ),
    ).toEqual(Either.left([AuthorizationCleanupFailureKind.Rejected]))
  })

  test.each([
    {
      name: 'typed completion failure',
      complete: () => Promise.resolve(rejectedCleanup),
    },
    {
      name: 'rejected completion',
      complete: () =>
        Promise.reject(new Error('cleanup completion unavailable')),
    },
  ])('releases the generation after $name', async ({ complete }) => {
    const release = mock(() => {})
    const dependencies: InterruptedAuthorizationCleanupRecoveryDependencies = {
      ...baseDependencies,
      completeAccountPickerAuthorizationCleanup: complete,
      releaseAccountPickerAuthorizationCleanup: release,
    }

    expect(
      await Effect.runPromise(
        Effect.either(recoverInterruptedAuthorizationCleanup(dependencies)),
      ),
    ).toEqual(Either.left([AuthorizationCleanupFailureKind.Rejected]))
    expect(release).toHaveBeenCalledWith('epoch-1')
  })
})
