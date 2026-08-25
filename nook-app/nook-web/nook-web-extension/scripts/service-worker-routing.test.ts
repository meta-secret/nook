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

const unusedAsyncDependency = mock(() =>
  Promise.reject(new Error('unused routing test dependency')),
)
const ensureExtensionSessionDocument = mock(() => Promise.resolve())
const openCompanionLauncher = mock(() => Promise.resolve())
const invalidateAllLoginMatchAvailability = mock(() => {})
const clearMountedAuthenticationSurfaces = mock(() => Promise.resolve())
const clearPendingAccountPickers = mock(() => Promise.resolve())
const refreshAuthenticationSurfaces = mock(() => Promise.resolve())

const lifecycleDependencies: ExtensionLifecycleRoutingDependencies = {
  clearPendingAccountPickers,
  clearMountedAuthenticationSurfaces,
  closeExtensionSessionDocument: unusedAsyncDependency,
  ensureExtensionSessionDocument,
  extensionSessionDocument: 'offscreen/session.html',
  handlePairingStateQuery: mock(() => false),
  hasPairingApprovedType: mock(() => false),
  importLocalEventLogUpdate: unusedAsyncDependency,
  importPairingAfterCompanionReady: unusedAsyncDependency,
  invalidateAllLoginMatchAvailability,
  isExtensionAuthenticationSurfacesRefreshMessage: mock(() => false),
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
  refreshAuthenticationSurfaces,
}

const externalDependencies: ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: unusedAsyncDependency,
  discoverPairedVaultIdentity: unusedAsyncDependency,
  hasPairingApprovedType: mock(() => false),
  importPairingAfterCompanionReady: unusedAsyncDependency,
  invalidateAllLoginMatchAvailability,
  isExtensionIdentityHandoffRequestMessage: mock(() => false),
  isExtensionPairedVaultIdentityDiscoveryMessage: mock(() => false),
  isExtensionPairedVaultIdentityHandoffRequestMessage: mock(() => false),
  isExtensionPairedVaultUnlockRequestMessage: mock(() => false),
  normalizeOpenCompanionLauncherMessage,
  openCompanionLauncher,
  refreshAuthenticationSurfaces,
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

  test('invalidates login-match metadata before and after locking the session', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    clearMountedAuthenticationSurfaces.mockClear()
    clearPendingAccountPickers.mockClear()
    const lifecycleEvents: string[] = []
    let pickerCleanupCount = 0
    const orderedPickerCleanup = mock(() => {
      pickerCleanupCount += 1
      lifecycleEvents.push(`picker-cleanup-${pickerCleanupCount}`)
      return Promise.resolve()
    })
    const orderedSurfaceCleanup = mock(() => {
      lifecycleEvents.push('authentication-surfaces-cleared')
      return Promise.resolve()
    })
    const closeExtensionSessionDocument = mock(() => {
      expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
      lifecycleEvents.push('session-closed')
      return Promise.resolve()
    })
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      clearMountedAuthenticationSurfaces: orderedSurfaceCleanup,
      clearPendingAccountPickers: orderedPickerCleanup,
      closeExtensionSessionDocument,
      isExtensionSessionLockMessage: () => true,
      isExtensionSessionEnsureMessage: () => false,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies,
      message: { type: 'test-session-lock' },
      sender: {
        id: 'nook-extension',
        url: 'chrome-extension://nook-extension/popup/index.html',
      },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
    await flushResponses()
    await flushResponses()
    expect(closeExtensionSessionDocument).toHaveBeenCalledTimes(1)
    expect(orderedSurfaceCleanup).toHaveBeenCalledTimes(1)
    expect(orderedPickerCleanup).toHaveBeenCalledTimes(2)
    expect(lifecycleEvents).toEqual([
      'picker-cleanup-1',
      'authentication-surfaces-cleared',
      'session-closed',
      'picker-cleanup-2',
    ])
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(2)
  })

  test('clears mounted authentication surfaces when the session expires', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    clearMountedAuthenticationSurfaces.mockClear()
    clearPendingAccountPickers.mockClear()
    const closeExtensionSessionDocument = mock(() => Promise.resolve())
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      closeExtensionSessionDocument,
      isExtensionSessionEnsureMessage: () => false,
      isExtensionSessionExpiryMessage: () => true,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies,
      message: { type: 'test-session-expiry' },
      sender: {
        id: 'nook-extension',
        url: 'chrome-extension://nook-extension/offscreen/session.html',
      },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
    await flushResponses()
    await flushResponses()
    expect(clearMountedAuthenticationSurfaces).toHaveBeenCalledTimes(1)
    expect(clearPendingAccountPickers).toHaveBeenCalledTimes(2)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(2)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('clears mounted authentication surfaces after a local event-log update', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    clearMountedAuthenticationSurfaces.mockClear()
    clearPendingAccountPickers.mockClear()
    const importLocalEventLogUpdate = mock(() =>
      Promise.resolve({
        ok: false as const,
        reason: 'event-log-access-revoked' as const,
      }),
    )
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      importLocalEventLogUpdate,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies,
      message: {
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'vault-1',
          eventLogRecords: [
            {
              eventId: 'event-1',
              path: '/vault-1/event-1',
              event: { schema_version: 1 },
            },
          ],
        },
      },
      sender: {
        id: 'nook-extension',
        url: 'https://simple.example.test/',
      },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
    await flushResponses()
    await flushResponses()
    expect(importLocalEventLogUpdate).toHaveBeenCalledTimes(1)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(2)
    expect(clearPendingAccountPickers).toHaveBeenCalledTimes(1)
    expect(clearMountedAuthenticationSurfaces).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'event-log-access-revoked',
    })
  })

  test('refreshes mounted authentication surfaces after a successful local event-log update', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    clearMountedAuthenticationSurfaces.mockClear()
    refreshAuthenticationSurfaces.mockClear()
    const importLocalEventLogUpdate = mock(() =>
      Promise.resolve({ ok: true as const }),
    )
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      importLocalEventLogUpdate,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies,
      message: {
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: 'vault-1',
          eventLogRecords: [
            {
              eventId: 'event-1',
              path: '/vault-1/event-1',
              event: { schema_version: 1 },
            },
          ],
        },
      },
      sender: {
        id: 'nook-extension',
        url: 'https://simple.example.test/',
      },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    await flushResponses()
    await flushResponses()
    expect(clearMountedAuthenticationSurfaces).not.toHaveBeenCalled()
    expect(refreshAuthenticationSurfaces).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('refreshes authentication surfaces after internal pairing approval', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    refreshAuthenticationSurfaces.mockClear()
    const importPairingAfterCompanionReady = mock(() =>
      Promise.resolve({ ok: true as const }),
    )
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      hasPairingApprovedType: () => true,
      importPairingAfterCompanionReady,
      isExtensionSessionEnsureMessage: () => false,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies,
      message: { type: 'test-pairing-approved' },
      sender: { id: 'nook-extension' },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
    await flushResponses()
    await flushResponses()
    expect(importPairingAfterCompanionReady).toHaveBeenCalledTimes(1)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(2)
    expect(refreshAuthenticationSurfaces).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('refreshes authentication surfaces after external pairing approval', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    refreshAuthenticationSurfaces.mockClear()
    const importPairingAfterCompanionReady = mock(() =>
      Promise.resolve({ ok: true as const }),
    )
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      hasPairingApprovedType: () => true,
      importPairingAfterCompanionReady,
    }
    const { routeExternalCompanionMessage } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExternalCompanionMessage>[0] = {
      dependencies,
      message: { type: 'test-pairing-approved' },
      sender: {
        id: 'simple-vault',
        url: 'https://simple.example.test/',
      },
      sendResponse,
    }

    expect(routeExternalCompanionMessage(routingArgs)).toBe(true)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
    await flushResponses()
    await flushResponses()
    expect(importPairingAfterCompanionReady).toHaveBeenCalledTimes(1)
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(2)
    expect(refreshAuthenticationSurfaces).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('routes an authorized authentication-surface refresh', async () => {
    invalidateAllLoginMatchAvailability.mockClear()
    refreshAuthenticationSurfaces.mockClear()
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      isExtensionAuthenticationSurfacesRefreshMessage: () => true,
      isExtensionSessionEnsureMessage: () => false,
    }
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    const routingArgs: Parameters<typeof routeExtensionLifecycleMessage>[0] = {
      dependencies,
      message: {
        type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
      },
      sender: { id: 'nook-extension' },
      sendResponse,
    }

    expect(routeExtensionLifecycleMessage(routingArgs)).toBe(true)
    await flushResponses()
    expect(invalidateAllLoginMatchAvailability).toHaveBeenCalledTimes(1)
    expect(refreshAuthenticationSurfaces).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
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
