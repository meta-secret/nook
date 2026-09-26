import { err, ok } from 'neverthrow'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
  ExtensionSessionDocumentStateKind,
} from '../src/background/service-worker/session-document'
import { describe, expect, mock, test } from 'bun:test'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { LocalEventLogUpdateFailure } from '../src/background/service-worker/pairing-import'
import type { ExtensionLifecycleRoutingDependencies } from '../src/background/service-worker/extension-lifecycle-routing'
import {
  AccountPickerCleanupMarkerStatus,
  completedCleanup,
  ensureExtensionSessionDocument,
  flushResponses,
  lifecycleDependencies,
  pendingCleanup,
  rejectedCleanup,
  refreshAuthenticationSurfaces,
  routedVaultEvent,
} from './service-worker-routing-test-support'

describe('service worker routing', () => {
  test('rejects an internal session command from a foreign sender synchronously', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies: lifecycleDependencies,
      message: { type: ExtensionRuntimeRequestType.EnsureRuntime },
      sender: { id: 'foreign-extension' },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'forbidden-sender',
    })
    expect(ensureExtensionSessionDocument).not.toHaveBeenCalled()
  })

  test('keeps an authorized lifecycle response channel open', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies: lifecycleDependencies,
      message: { type: ExtensionRuntimeRequestType.EnsureRuntime },
      sender: { id: 'nook-extension' },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    await flushResponses()
    expect(ensureExtensionSessionDocument).toHaveBeenCalledTimes(1)
  })

  test('closes the ensure-runtime response with a typed failure when startup rejects', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      ensureExtensionSessionDocument: () =>
        Promise.reject(new Error('session startup rejected')),
    }

    expect(
      routeExtensionLifecycleMessage({
        dependencies,
        message: { type: ExtensionRuntimeRequestType.EnsureRuntime },
        sender: { id: 'nook-extension' },
        sendResponse,
      }),
    ).toBe(true)
    await flushResponses()

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'session-runtime-failed',
    })
  })

  test('refreshes mounted authentication surfaces from an authorized sender', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    expect(
      routeExtensionLifecycleMessage({
        dependencies: lifecycleDependencies,
        message: {
          type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
        },
        sender: { id: 'nook-extension' },
        sendResponse,
      }),
    ).toBe(true)
    await flushResponses()

    expect(refreshAuthenticationSurfaces).toHaveBeenCalled()
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('keeps picker authorization invalid until lock cleanup finishes', async () => {
    const events: string[] = []
    let pickerCleanupCount = 0
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () => {
        events.push('authorization-invalidated')
        return Promise.resolve({
          authorizationGeneration: 'epoch-4',
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        })
      },
      clearPendingAccountPickers: () => {
        pickerCleanupCount += 1
        events.push(`pickers-cleared-${pickerCleanupCount}`)
        return Promise.resolve()
      },
      clearStagedAuthenticatorEnrollments: () => {
        events.push('enrollments-cleared')
      },
      closeExtensionSessionDocument: () => {
        events.push('session-closed')
        return Promise.resolve(
          ok<
            ExtensionSessionDocumentStateKind.Closed,
            ExtensionSessionTransportFailure
          >(ExtensionSessionDocumentStateKind.Closed),
        )
      },
      completeAccountPickerAuthorizationCleanup: ({
        authorizationGeneration,
      }) => {
        events.push(`authorization-restored-${authorizationGeneration}`)
        return Promise.resolve(completedCleanup)
      },
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    expect(
      routeExtensionLifecycleMessage({
        dependencies,
        message: { type: ExtensionSessionMessageType.Lock },
        sender: {
          id: 'nook-extension',
          url: 'chrome-extension://nook-extension/popup/index.html',
        },
        sendResponse,
      }),
    ).toBe(true)
    await flushResponses()
    await flushResponses()
    await flushResponses()

    expect(events).toEqual([
      'authorization-invalidated',
      'session-closed',
      'enrollments-cleared',
      'pickers-cleared-1',
      'pickers-cleared-2',
      'enrollments-cleared',
      'authorization-restored-epoch-4',
    ])
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test.each([pendingCleanup, rejectedCleanup])(
    'reports lock cleanup outcome %j',
    async (outcome) => {
      const { routeExtensionLifecycleMessage } =
        await import('../src/background/service-worker/extension-lifecycle-routing')
      const sendResponse = mock(() => {})
      const dependencies: ExtensionLifecycleRoutingDependencies = {
        ...lifecycleDependencies,
        clearPendingAccountPickers: () => Promise.resolve(),
        closeExtensionSessionDocument: () =>
          Promise.resolve(
            ok<
              ExtensionSessionDocumentStateKind.Closed,
              ExtensionSessionTransportFailure
            >(ExtensionSessionDocumentStateKind.Closed),
          ),
        completeAccountPickerAuthorizationCleanup: () =>
          Promise.resolve(outcome),
      }
      routeExtensionLifecycleMessage({
        dependencies,
        message: { type: ExtensionSessionMessageType.Lock },
        sender: { id: 'nook-extension' },
        sendResponse,
      })
      await flushResponses()
      await flushResponses()
      await flushResponses()
      expect(sendResponse).toHaveBeenCalledWith(
        'error' in outcome
          ? { ok: false, reason: 'session-lock-failed' }
          : { ok: true },
      )
    },
  )

  test.each([
    ExtensionSessionTransportFailureKind.ObservationFailed,
    ExtensionSessionTransportFailureKind.ClosureFailed,
  ])(
    'reports lock failure when inherited document cleanup fails with %s',
    async (kind) => {
      const { routeExtensionLifecycleMessage } =
        await import('../src/background/service-worker/extension-lifecycle-routing')
      const sendResponse = mock(() => {})
      const completeCleanup = mock(() => Promise.resolve(completedCleanup))
      const dependencies: ExtensionLifecycleRoutingDependencies = {
        ...lifecycleDependencies,
        clearPendingAccountPickers: () => Promise.resolve(),
        closeExtensionSessionDocument: () =>
          Promise.resolve(err(new ExtensionSessionTransportFailure(kind))),
        completeAccountPickerAuthorizationCleanup: completeCleanup,
      }
      expect(
        routeExtensionLifecycleMessage({
          dependencies,
          message: { type: ExtensionSessionMessageType.Lock },
          sender: { id: 'nook-extension' },
          sendResponse,
        }),
      ).toBe(true)
      await flushResponses()
      await flushResponses()
      await flushResponses()
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        reason: 'session-lock-failed',
      })
      expect(completeCleanup).not.toHaveBeenCalled()
    },
  )

  test('closes the session when authorization initialization fails', async () => {
    const events: string[] = []
    const closeSession = mock(() => {
      events.push('session-close-started')
      return Promise.resolve(
        ok<
          ExtensionSessionDocumentStateKind.Closed,
          ExtensionSessionTransportFailure
        >(ExtensionSessionDocumentStateKind.Closed),
      )
    })
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () => {
        events.push('authorization-cleanup-started')
        return Promise.reject(new Error('session storage unavailable'))
      },
      clearPendingAccountPickers: () => Promise.resolve(),
      closeExtensionSessionDocument: closeSession,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    routeExtensionLifecycleMessage({
      dependencies,
      message: { type: ExtensionSessionMessageType.Lock },
      sender: {
        id: 'nook-extension',
        url: 'chrome-extension://nook-extension/popup/index.html',
      },
      sendResponse,
    })
    await flushResponses()
    await flushResponses()

    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      'authorization-cleanup-started',
      'session-close-started',
    ])
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'session-lock-failed',
    })
  })

  test('keeps authorization invalid when cleanup completion rejects', async () => {
    const release = mock(() => {})
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      clearPendingAccountPickers: () => Promise.resolve(),
      closeExtensionSessionDocument: () =>
        Promise.resolve(
          ok<
            ExtensionSessionDocumentStateKind.Closed,
            ExtensionSessionTransportFailure
          >(ExtensionSessionDocumentStateKind.Closed),
        ),
      completeAccountPickerAuthorizationCleanup: () =>
        Promise.reject(new Error('completion unavailable')),
      releaseAccountPickerAuthorizationCleanup: release,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    routeExtensionLifecycleMessage({
      dependencies,
      message: { type: ExtensionSessionMessageType.Lock },
      sender: { id: 'nook-extension' },
      sendResponse,
    })
    await flushResponses()
    await flushResponses()
    await flushResponses()

    expect(release).toHaveBeenCalled()
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'session-lock-failed',
    })
  })

  test.each([
    LocalEventLogUpdateFailure.EventLogAccessRevoked,
    LocalEventLogUpdateFailure.EventLogImportFailed,
    new Error('unexpected import exception'),
  ])('fails closed for %s', async (reason) => {
    const events: string[] = []
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () => {
        events.push('authorization-invalidated')
        return Promise.resolve({
          authorizationGeneration: 'epoch-14',
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        })
      },
      clearPendingAccountPickers: () => {
        events.push('pickers-cleared')
        return Promise.resolve()
      },
      closeExtensionSessionDocument: () => {
        events.push('session-closed')
        return Promise.resolve(
          ok<
            ExtensionSessionDocumentStateKind.Closed,
            ExtensionSessionTransportFailure
          >(ExtensionSessionDocumentStateKind.Closed),
        )
      },
      importLocalEventLogUpdate: () => {
        events.push('revocation-reconciled')
        if (reason instanceof Error) return Promise.reject(reason)
        return Promise.resolve({
          ok: false as const,
          reason,
        })
      },
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const completedResponse = new Promise<unknown>((sendResponse) => {
      routeExtensionLifecycleMessage({
        dependencies,
        message: {
          type: 'nook:extension-local-event-log-updated',
          payload: {
            vaultStoreId: 'store_abcdefghijk',
            eventLogRecords: [
              {
                eventId: 'event-1',
                path: 'events/1',
                event: routedVaultEvent,
              },
            ],
          },
        },
        sender: { id: 'nook-extension', url: 'https://simple.example.test/' },
        sendResponse,
      })
    })
    const response = await completedResponse

    expect(events.slice(0, 2)).toEqual([
      'authorization-invalidated',
      'revocation-reconciled',
    ])
    expect(events.indexOf('session-closed')).toBeLessThan(
      events.indexOf('pickers-cleared'),
    )
    expect(response).toEqual({
      ok: false,
      reason:
        reason instanceof Error
          ? LocalEventLogUpdateFailure.EventLogImportFailed
          : reason,
    })
  })

  test.each([
    { ok: true as const, eventCount: 1 },
    { ok: false as const, reason: LocalEventLogUpdateFailure.VaultNotPaired },
  ])('preserves the warm session for %j', async (response) => {
    const events: string[] = []
    const closeSession = mock(() =>
      Promise.resolve(
        ok<
          ExtensionSessionDocumentStateKind.Closed,
          ExtensionSessionTransportFailure
        >(ExtensionSessionDocumentStateKind.Closed),
      ),
    )
    const clearPickers = mock(() => Promise.resolve())
    const clearEnrollments = mock(() => {})
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      closeExtensionSessionDocument: closeSession,
      clearPendingAccountPickers: clearPickers,
      clearStagedAuthenticatorEnrollments: clearEnrollments,
      beginAccountPickerAuthorizationCleanup: () =>
        Promise.resolve({
          authorizationGeneration: 'epoch-15',
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        }),
      importLocalEventLogUpdate: () => Promise.resolve(response),
      rebindStagedAuthenticatorEnrollmentsAuthorization: (generation) => {
        events.push(`enrollments-rebound-${generation}`)
      },
      completeAccountPickerAuthorizationCleanup: ({
        authorizationGeneration,
      }) => {
        events.push(`authorization-restored-${authorizationGeneration}`)
        return Promise.resolve(completedCleanup)
      },
      refreshAuthenticationSurfaces: () => {
        events.push('authentication-surfaces-refreshed')
        return Promise.resolve()
      },
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const completedResponse = new Promise<unknown>((sendResponse) => {
      routeExtensionLifecycleMessage({
        dependencies,
        message: {
          type: 'nook:extension-local-event-log-updated',
          payload: {
            vaultStoreId: 'store_abcdefghijk',
            eventLogRecords: [
              {
                eventId: 'event-1',
                path: 'events/1',
                event: routedVaultEvent,
              },
            ],
          },
        },
        sender: { id: 'nook-extension', url: 'https://simple.example.test/' },
        sendResponse,
      })
    })
    const actualResponse = await completedResponse

    expect(events).toEqual([
      'enrollments-rebound-epoch-15',
      'authorization-restored-epoch-15',
      ...(response.ok ? ['authentication-surfaces-refreshed'] : []),
    ])
    expect(actualResponse).toEqual(response)
    expect(closeSession).not.toHaveBeenCalled()
    expect(clearPickers).not.toHaveBeenCalled()
    expect(clearEnrollments).not.toHaveBeenCalled()
    events.length = 0
    const release = mock(() => {})
    const rejectedDependencies: ExtensionLifecycleRoutingDependencies = {
      ...dependencies,
      completeAccountPickerAuthorizationCleanup: () =>
        Promise.resolve(rejectedCleanup),
      releaseAccountPickerAuthorizationCleanup: release,
    }
    const rejectedResponse = await new Promise<unknown>((sendResponse) => {
      routeExtensionLifecycleMessage({
        dependencies: rejectedDependencies,
        message: {
          type: 'nook:extension-local-event-log-updated',
          payload: {
            vaultStoreId: 'store_abcdefghijk',
            eventLogRecords: [
              {
                eventId: 'event-1',
                path: 'events/1',
                event: routedVaultEvent,
              },
            ],
          },
        },
        sender: { id: 'nook-extension', url: 'https://simple.example.test/' },
        sendResponse,
      })
    })
    expect(events).toEqual(['enrollments-rebound-epoch-15'])
    expect(rejectedResponse).toEqual(response)
    expect(release).not.toHaveBeenCalled()
  })
})
