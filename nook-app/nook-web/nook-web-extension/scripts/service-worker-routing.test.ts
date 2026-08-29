import { describe, expect, mock, test } from 'bun:test'
import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../nook-web-shared/src/extension/companion-launcher-message'
import { normalizeOpenCompanionLauncherMessage } from '../../nook-web-shared/src/extension/companion-launcher-message-adapter'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import type { ExtensionLifecycleRoutingDependencies } from '../src/background/service-worker/extension-lifecycle-routing'
import type { ExternalCompanionRoutingDependencies } from '../src/background/service-worker/external-companion-routing'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
globalThis.chrome = {
  runtime: {
    id: 'nook-extension',
    getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
  },
} as typeof chrome

const { AccountPickerCleanupMarkerStatus } =
  await import('../src/background/service-worker/account-pickers')

const unusedAsyncDependency = mock(() =>
  Promise.reject(new Error('unused routing test dependency')),
)
const ensureExtensionSessionDocument = mock(() => Promise.resolve())
const openCompanionLauncher = mock(() => Promise.resolve())
const accountPickerAuthorizationCleanupPending = mock(() =>
  Promise.resolve(false),
)
const beginAccountPickerAuthorizationCleanup = mock(() =>
  Promise.resolve({
    authorizationGeneration: 1,
    markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
  }),
)
const clearPendingAccountPickers = mock(() => Promise.resolve())
const clearMountedAuthenticationSurfaces = mock(() => Promise.resolve())
const clearStagedAuthenticatorEnrollments = mock(() => {})
const rebindStagedAuthenticatorEnrollmentsAuthorization = mock(() => {})
const completeAccountPickerAuthorizationCleanup = mock(() => Promise.resolve())
const releaseAccountPickerAuthorizationCleanup = mock(() => {})
const invalidateAllLoginMatchAvailability = mock(() => {})
const refreshAuthenticationSurfaces = mock(() => Promise.resolve())

const lifecycleDependencies: ExtensionLifecycleRoutingDependencies = {
  accountPickerAuthorizationCleanupPending,
  beginAccountPickerAuthorizationCleanup,
  clearPendingAccountPickers,
  clearMountedAuthenticationSurfaces,
  clearStagedAuthenticatorEnrollments,
  closeExtensionSessionDocument: unusedAsyncDependency,
  completeAccountPickerAuthorizationCleanup,
  ensureExtensionSessionDocument,
  extensionSessionDocument: 'offscreen/session.html',
  handlePairingStateQuery: mock(() => false),
  hasPairingApprovedType: mock(() => false),
  importLocalEventLogUpdate: unusedAsyncDependency,
  importPairingAfterCompanionReady: unusedAsyncDependency,
  invalidateAllLoginMatchAvailability,
  isExtensionAuthenticationSurfacesRefreshMessage: (message) =>
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  isExtensionPairingStateQueryMessage: mock(() => false),
  isExtensionSessionEnsureMessage: (message) =>
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.EnsureRuntime,
  isExtensionSessionExpiryMessage: mock(() => false),
  isExtensionSessionLockMessage: mock(() => false),
  openCompanionLauncher,
  openExtensionPairing: unusedAsyncDependency,
  openSimpleVault: mock(() => {}),
  queryActiveTabLoginDetection: unusedAsyncDependency,
  releaseAccountPickerAuthorizationCleanup,
  rebindStagedAuthenticatorEnrollmentsAuthorization,
  refreshAuthenticationSurfaces,
}

const externalDependencies: ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: unusedAsyncDependency,
  discoverPairedVaultIdentity: unusedAsyncDependency,
  hasPairingApprovedType: mock(() => false),
  importPairingAfterCompanionReady: unusedAsyncDependency,
  isExtensionIdentityHandoffRequestMessage: mock(() => false),
  isExtensionPairedVaultIdentityDiscoveryMessage: mock(() => false),
  isExtensionPairedVaultIdentityHandoffRequestMessage: mock(() => false),
  isExtensionPairedVaultUnlockRequestMessage: mock(() => false),
  normalizeOpenCompanionLauncherMessage,
  openCompanionLauncher,
  requestPairedVaultUnlock: unusedAsyncDependency,
}

async function flushResponses(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

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
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
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

    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalled()
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
          authorizationGeneration: 4,
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        })
      },
      clearPendingAccountPickers: () => {
        pickerCleanupCount += 1
        events.push(`pickers-cleared-${pickerCleanupCount}`)
        return Promise.resolve()
      },
      clearMountedAuthenticationSurfaces: () => {
        events.push('surfaces-cleared')
        return Promise.resolve()
      },
      clearStagedAuthenticatorEnrollments: () => {
        events.push('enrollments-cleared')
      },
      closeExtensionSessionDocument: () => {
        events.push('session-closed')
        return Promise.resolve()
      },
      completeAccountPickerAuthorizationCleanup: (generation) => {
        events.push(`authorization-restored-${generation}`)
        return Promise.resolve()
      },
      invalidateAllLoginMatchAvailability: () => {
        events.push('login-matches-invalidated')
      },
      isExtensionSessionEnsureMessage: () => false,
      isExtensionSessionLockMessage: () => true,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    expect(
      routeExtensionLifecycleMessage({
        dependencies,
        message: { type: 'test-session-lock' },
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
      'login-matches-invalidated',
      'authorization-invalidated',
      'enrollments-cleared',
      'session-closed',
      'pickers-cleared-1',
      'surfaces-cleared',
      'pickers-cleared-2',
      'enrollments-cleared',
      'authorization-restored-4',
      'login-matches-invalidated',
    ])
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('closes the session and releases cleanup when marker persistence fails', async () => {
    const closeSession = mock(() => Promise.resolve())
    const releaseCleanup = mock(() => {})
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () =>
        Promise.resolve({
          authorizationGeneration: 9,
          markerStatus: AccountPickerCleanupMarkerStatus.Unavailable,
        }),
      clearPendingAccountPickers: () => Promise.resolve(),
      closeExtensionSessionDocument: closeSession,
      isExtensionSessionEnsureMessage: () => false,
      isExtensionSessionLockMessage: () => true,
      releaseAccountPickerAuthorizationCleanup: releaseCleanup,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    routeExtensionLifecycleMessage({
      dependencies,
      message: { type: 'test-session-lock' },
      sender: {
        id: 'nook-extension',
        url: 'chrome-extension://nook-extension/popup/index.html',
      },
      sendResponse,
    })
    await flushResponses()
    await flushResponses()

    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(releaseCleanup).toHaveBeenCalledWith(9)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'session-lock-failed',
    })
  })

  test('recovers a persisted cleanup marker after worker restart', async () => {
    const closeSession = mock(() => Promise.resolve())
    const completeCleanup = mock(() => Promise.resolve())
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      accountPickerAuthorizationCleanupPending: () => Promise.resolve(true),
      beginAccountPickerAuthorizationCleanup: () =>
        Promise.resolve({
          authorizationGeneration: 12,
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        }),
      clearPendingAccountPickers: () => Promise.resolve(),
      closeExtensionSessionDocument: closeSession,
      completeAccountPickerAuthorizationCleanup: completeCleanup,
    }
    const { recoverInterruptedAuthorizationCleanup } =
      await import('../src/background/service-worker/extension-lifecycle-routing')

    await recoverInterruptedAuthorizationCleanup(dependencies)

    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(completeCleanup).toHaveBeenCalledWith(12)
  })

  test('invalidates authorization before a failed startup marker lookup', async () => {
    const events: string[] = []
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      accountPickerAuthorizationCleanupPending: () => {
        events.push('marker-read-started')
        return Promise.reject(new Error('session storage unavailable'))
      },
      beginAccountPickerAuthorizationCleanup: () => {
        events.push('authorization-invalidated')
        return Promise.resolve({
          authorizationGeneration: 13,
          markerStatus: AccountPickerCleanupMarkerStatus.Unavailable,
        })
      },
    }
    const { recoverInterruptedAuthorizationCleanup } =
      await import('../src/background/service-worker/extension-lifecycle-routing')

    await expect(
      recoverInterruptedAuthorizationCleanup(dependencies),
    ).rejects.toThrow('session storage unavailable')
    expect(events).toEqual(['marker-read-started', 'authorization-invalidated'])
  })

  test('invalidates picker authorization before reconciling revocation', async () => {
    const events: string[] = []
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () => {
        events.push('authorization-invalidated')
        return Promise.resolve({
          authorizationGeneration: 14,
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        })
      },
      clearPendingAccountPickers: () => {
        events.push('pickers-cleared')
        return Promise.resolve()
      },
      closeExtensionSessionDocument: () => {
        events.push('session-closed')
        return Promise.resolve()
      },
      importLocalEventLogUpdate: () => {
        events.push('revocation-reconciled')
        return Promise.resolve({
          ok: false as const,
          reason: 'event-log-access-revoked',
        })
      },
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})

    routeExtensionLifecycleMessage({
      dependencies,
      message: {
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'vault-1',
          eventLogRecords: [
            {
              eventId: 'event-1',
              path: 'events/1',
              event: { schema_version: 1 },
            },
          ],
        },
      },
      sender: { id: 'nook-extension', url: 'https://simple.example.test/' },
      sendResponse,
    })
    await flushResponses()
    await flushResponses()

    expect(events.slice(0, 2)).toEqual([
      'authorization-invalidated',
      'revocation-reconciled',
    ])
    expect(events.indexOf('session-closed')).toBeLessThan(
      events.indexOf('pickers-cleared'),
    )
    expect(events).toContain('pickers-cleared')
  })

  test('rebinds staged enrollment when reconciliation preserves access', async () => {
    const events: string[] = []
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () =>
        Promise.resolve({
          authorizationGeneration: 15,
          markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
        }),
      importLocalEventLogUpdate: () => Promise.resolve({ ok: true as const }),
      rebindStagedAuthenticatorEnrollmentsAuthorization: (generation) => {
        events.push(`enrollments-rebound-${generation}`)
      },
      completeAccountPickerAuthorizationCleanup: (generation) => {
        events.push(`authorization-restored-${generation}`)
        return Promise.resolve()
      },
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')

    routeExtensionLifecycleMessage({
      dependencies,
      message: {
        type: 'nook:extension-local-event-log-updated',
        payload: { vaultStoreId: 'vault-1', eventLogRecords: [] },
      },
      sender: { id: 'nook-extension', url: 'https://simple.example.test/' },
      sendResponse: mock(() => {}),
    })
    await flushResponses()
    await flushResponses()

    expect(events).toEqual([
      'enrollments-rebound-15',
      'authorization-restored-15',
    ])
  })

  test('rejects a companion launcher request from an unauthorized external sender', async () => {
    openCompanionLauncher.mockClear()
    const { routeExternalCompanionMessage } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExternalCompanionMessage>[0] = {
      dependencies: externalDependencies,
      message: {
        type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
      },
      sender: {
        id: 'foreign-extension',
        url: 'https://example.com',
      },
      sendResponse,
    }

    expect(routeExternalCompanionMessage(routingArgs)).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'forbidden-sender',
    })
    expect(openCompanionLauncher).not.toHaveBeenCalled()
  })

  test('keeps an authorized external launcher response channel open', async () => {
    openCompanionLauncher.mockClear()
    const { routeExternalCompanionMessage } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExternalCompanionMessage>[0] = {
      dependencies: externalDependencies,
      message: {
        type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
      },
      sender: {
        id: 'simple-vault',
        url: 'https://simple.example.test/',
      },
      sendResponse,
    }

    expect(routeExternalCompanionMessage(routingArgs)).toBe(true)
    await flushResponses()
    expect(openCompanionLauncher).toHaveBeenCalledTimes(1)
    expect(openCompanionLauncher).toHaveBeenCalledWith(
      OpenCompanionLauncherIntent.Default,
    )
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('normalizes pair intent before internal launcher routing', async () => {
    openCompanionLauncher.mockClear()
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies: lifecycleDependencies,
      message: {
        type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
        payload: { intent: OpenCompanionLauncherIntent.Pair },
      },
      sender: { id: 'nook-extension' },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    await flushResponses()
    expect(openCompanionLauncher).toHaveBeenCalledWith(
      OpenCompanionLauncherIntent.Pair,
    )
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })
})
