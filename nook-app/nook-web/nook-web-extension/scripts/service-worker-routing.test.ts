import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
import { err, ok } from 'neverthrow'
import { OpenSimpleVaultMessageType } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { describe, expect, mock, test } from 'bun:test'
import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../nook-web-shared/src/extension/companion-launcher-message'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../nook-web-shared/src/extension/companion-launcher-message'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import type { ExtensionLifecycleRoutingDependencies } from '../src/background/service-worker/extension-lifecycle-routing'
import type { LocalEventLogUpdateResult } from '../src/background/service-worker/pairing-import'
import type { ExternalCompanionRoutingDependencies } from '../src/background/service-worker/external-companion-routing'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  AccountPickerAuthorizationLifecycle,
  CleanupEvidence,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  extensionPairingGrantPolicyReady,
  type StoredExtensionPairingGrant,
} from '../src/background/pairing-grants'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { extensionPairingIdentity } from '../src/background/service-worker/pairing-identity'
import { ExtensionPairingStateQueryMessage } from '../src/lib/pairing-state'
import {
  isExtensionAuthenticationSurfacesRefreshMessage,
  isExtensionSessionEnsureMessage,
  isExtensionSessionExpiryMessage,
  isExtensionSessionLockMessage,
} from '../src/background/service-worker/session-runtime-messages'
import {
  ExtensionIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityDiscoveryMessage,
  ExtensionPairedVaultIdentityHandoffRequestMessage,
  ExtensionPairedVaultUnlockRequestMessage,
} from '../../nook-web-shared/src/extension/runtime-messages'

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
const {
  importLocalEventLogUpdateWithDependencies,
  LocalEventLogUpdateFailure,
} = await import('../src/background/service-worker/pairing-import')

const routedGrant: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'vault-1',
  deviceId: 'device-1',
  devicePublicKey: 'device-public-key',
  deviceSigningPublicKey: 'device-signing-public-key',
  vaultName: 'Private vault',
  deviceLabel: 'Test browser',
  approvedAt: '2026-09-11T00:00:00.000Z',
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-09-11T00:00:00.000Z',
}

// Obtain the generated outcome variants from Rust rather than mirroring them.
await companionWasmReady
const started = new AccountPickerAuthorizationLifecycle('opening')
  .begin_cleanup('cleanup')
  .into_lifecycle()
const rejectedTransition = started.complete_cleanup(
  'stale',
  CleanupEvidence.Full,
)
const rejectedCleanup = rejectedTransition.outcome()
const pendingTransition = rejectedTransition
  .into_lifecycle()
  .begin_cleanup('overlap')
  .into_lifecycle()
  .complete_cleanup('cleanup', CleanupEvidence.Full)
const pendingCleanup = pendingTransition.outcome()
const completedTransition = pendingTransition
  .into_lifecycle()
  .complete_cleanup('cleanup', CleanupEvidence.Full)
const completedCleanup = completedTransition.outcome()
completedTransition.into_lifecycle().free()

const unusedAsyncDependency = mock(() =>
  Promise.reject(new Error('unused routing test dependency')),
)
const ensureExtensionSessionDocument = mock(() => Promise.resolve(ok()))
const openCompanionLauncher = mock(() => Promise.resolve())
const accountPickerAuthorizationCleanupPending = mock(() =>
  Promise.resolve(false),
)
const beginAccountPickerAuthorizationCleanup = mock(() =>
  Promise.resolve({
    authorizationGeneration: 'epoch-1',
    markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
  }),
)
const clearPendingAccountPickers = mock(() => Promise.resolve())
const clearStagedAuthenticatorEnrollments = mock(() => {})
const rebindStagedAuthenticatorEnrollmentsAuthorization = mock(() => {})
const completeAccountPickerAuthorizationCleanup = mock(() =>
  Promise.resolve(completedCleanup),
)
const releaseAccountPickerAuthorizationCleanup = mock(() => {})
const refreshAuthenticationSurfaces = mock(() => Promise.resolve())

const lifecycleDependencies: ExtensionLifecycleRoutingDependencies = {
  accountPickerAuthorizationCleanupPending,
  beginAccountPickerAuthorizationCleanup,
  clearPendingAccountPickers,
  clearStagedAuthenticatorEnrollments,
  closeExtensionSessionDocument: mock(() =>
    Promise.resolve(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.ClosureFailed,
        ),
      ),
    ),
  ),
  completeAccountPickerAuthorizationCleanup,
  ensureExtensionSessionDocument,
  extensionSessionDocument: 'offscreen/session.html',
  handlePairingStateQuery: mock(() => false),
  hasPairingApprovedType: extensionPairingIdentity.hasPairingApprovedType,
  importLocalEventLogUpdate: unusedAsyncDependency,
  importPairingAfterCompanionReady: unusedAsyncDependency,
  isExtensionAuthenticationSurfacesRefreshMessage,
  isExtensionPairingStateQueryMessage: ExtensionPairingStateQueryMessage.is,
  isExtensionSessionEnsureMessage,
  isExtensionSessionExpiryMessage,
  isExtensionSessionLockMessage,
  openCompanionLauncher,
  openExtensionPairing: unusedAsyncDependency,
  openSimpleVault: mock(() => Promise.resolve()),
  releaseAccountPickerAuthorizationCleanup,
  rebindStagedAuthenticatorEnrollmentsAuthorization,
  refreshAuthenticationSurfaces,
}

const externalDependencies: ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: unusedAsyncDependency,
  createPairedIdentityHandoff: unusedAsyncDependency,
  discoverPairedVaultIdentity: unusedAsyncDependency,
  hasPairingApprovedType: extensionPairingIdentity.hasPairingApprovedType,
  importPairingAfterCompanionReady: unusedAsyncDependency,
  isExtensionIdentityHandoffRequestMessage:
    ExtensionIdentityHandoffRequestMessage.is,
  isExtensionPairedVaultIdentityDiscoveryMessage:
    ExtensionPairedVaultIdentityDiscoveryMessage.is,
  isExtensionPairedVaultIdentityHandoffRequestMessage:
    ExtensionPairedVaultIdentityHandoffRequestMessage.is,
  isExtensionPairedVaultUnlockRequestMessage:
    ExtensionPairedVaultUnlockRequestMessage.is,
  normalizeOpenCompanionLauncherMessage:
    NormalizedOpenCompanionLauncherMessageSchema.normalizeOpenCompanionLauncherMessage,
  openCompanionLauncher,
  refreshAuthenticationSurfaces,
  requestPairedVaultUnlock: unusedAsyncDependency,
}

async function flushResponses(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function routeDecodedLocalUpdate(
  sendSession: Parameters<
    typeof importLocalEventLogUpdateWithDependencies
  >[0]['sendSession'],
) {
  const policy = await extensionPairingGrantPolicyReady
  const key = policy.pairingGrantStorageKey(routedGrant.vaultStoreId)
  const importLocalEventLogUpdate = (
    request: Parameters<
      ExtensionLifecycleRoutingDependencies['importLocalEventLogUpdate']
    >[0],
  ) =>
    importLocalEventLogUpdateWithDependencies({
      ...request,
      ensureSession: async () => ok(),
      persistPairingStorage: async () => {},
      loadPairingStorage: async () => ({ [key]: routedGrant }),
      pairingPolicyReady: extensionPairingGrantPolicyReady,
      importEventLog: async () => ({
        vaultStoreId: routedGrant.vaultStoreId,
        accessGranted: true,
        eventCount: 1,
        heads: ['event-1'],
      }),
      sendSession,
    })
  const closeSession = mock(() => Promise.resolve(ok()))
  const dependencies: ExtensionLifecycleRoutingDependencies = {
    ...lifecycleDependencies,
    closeExtensionSessionDocument: closeSession,
    importLocalEventLogUpdate,
  }
  const { routeExtensionLifecycleMessage } =
    await import('../src/background/service-worker/extension-lifecycle-routing')
  const response = new Promise<LocalEventLogUpdateResult>((sendResponse) => {
    routeExtensionLifecycleMessage({
      dependencies,
      message: {
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: routedGrant.vaultStoreId,
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
  })
  return { response: await response, closeSession }
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
        return Promise.resolve(ok())
      },
      completeAccountPickerAuthorizationCleanup: (generation) => {
        events.push(`authorization-restored-${generation}`)
        return Promise.resolve(completedCleanup)
      },
      isExtensionSessionEnsureMessage,
      isExtensionSessionLockMessage,
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
        closeExtensionSessionDocument: () => Promise.resolve(ok()),
        completeAccountPickerAuthorizationCleanup: () =>
          Promise.resolve(outcome),
        isExtensionSessionEnsureMessage,
        isExtensionSessionLockMessage,
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
        isExtensionSessionEnsureMessage,
        isExtensionSessionLockMessage,
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
    const closeSession = mock(() => Promise.resolve(ok()))
    const dependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      beginAccountPickerAuthorizationCleanup: () =>
        Promise.reject(new Error('session storage unavailable')),
      clearPendingAccountPickers: () => Promise.resolve(),
      closeExtensionSessionDocument: closeSession,
      isExtensionSessionEnsureMessage,
      isExtensionSessionLockMessage,
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
      closeExtensionSessionDocument: () => Promise.resolve(ok()),
      completeAccountPickerAuthorizationCleanup: () =>
        Promise.reject(new Error('completion unavailable')),
      isExtensionSessionEnsureMessage,
      isExtensionSessionLockMessage,
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
          authorizationGeneration: 'epoch-13',
          markerStatus: AccountPickerCleanupMarkerStatus.Unavailable,
        })
      },
    }
    const {
      recoverInterruptedAuthorizationCleanup,
      AuthorizationCleanupFailureKind,
    } =
      await import('../src/background/service-worker/extension-lifecycle-routing')

    await expect(
      recoverInterruptedAuthorizationCleanup(dependencies),
    ).resolves.toEqual(
      err([AuthorizationCleanupFailureKind.MarkerLookupFailed]),
    )
    expect(events).toEqual(['marker-read-started', 'authorization-invalidated'])
    const rejectedDependencies: ExtensionLifecycleRoutingDependencies = {
      ...lifecycleDependencies,
      completeAccountPickerAuthorizationCleanup: () =>
        Promise.resolve(rejectedCleanup),
    }
    await expect(
      recoverInterruptedAuthorizationCleanup(rejectedDependencies),
    ).resolves.toEqual(err([AuthorizationCleanupFailureKind.Rejected]))
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
        return Promise.resolve(ok())
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
    const closeSession = mock(() => Promise.resolve(ok()))
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
      completeAccountPickerAuthorizationCleanup: (generation) => {
        events.push(`authorization-restored-${generation}`)
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
    })
    expect(events).toEqual(['enrollments-rebound-epoch-15'])
    expect(rejectedResponse).toEqual(response)
    expect(release).not.toHaveBeenCalled()
  })

  test('keeps the decoded local-update session usable for a subsequent authenticator request', async () => {
    const delivered: ExtensionSessionMessageType[] = []
    const sendSession: Parameters<typeof routeDecodedLocalUpdate>[0] = async (
      message,
    ) => {
      if (!message || typeof message !== 'object' || !('type' in message)) {
        throw new Error('expected a typed extension session request')
      }
      if (message.type === ExtensionSessionMessageType.ClassifyGrantAuthority) {
        delivered.push(ExtensionSessionMessageType.ClassifyGrantAuthority)
        return ok({ kind: 'Authorized' as const, grant: routedGrant })
      }
      if (message.type === ExtensionSessionMessageType.UpdateVault) {
        delivered.push(ExtensionSessionMessageType.UpdateVault)
        return ok({ ok: true })
      }
      if (message.type === ExtensionSessionMessageType.AuthenticatorCode) {
        delivered.push(ExtensionSessionMessageType.AuthenticatorCode)
        return ok({
          ok: true,
          code: '012345',
          expiresAt: Date.now() + 30_000,
        })
      }
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        ),
      )
    }
    const update = await routeDecodedLocalUpdate(sendSession)

    expect(update.response).toEqual({ ok: true, eventCount: 1 })
    expect(update.closeSession).not.toHaveBeenCalled()
    const { ExtensionAuthenticatorSession } =
      await import('../src/background/service-worker/authenticator-session-adapter')
    const authenticator = new ExtensionAuthenticatorSession({
      sendSessionMessage: sendSession,
    })
    await expect(
      authenticator.authenticatorCodeFromSession({
        grant: routedGrant,
        secretId: 'authenticator-1',
      }),
    ).resolves.toEqual(
      ok({ ok: true, code: '012345', expiresAt: expect.any(Number) }),
    )
    expect(delivered).toEqual([
      ExtensionSessionMessageType.ClassifyGrantAuthority,
      ExtensionSessionMessageType.UpdateVault,
      ExtensionSessionMessageType.AuthenticatorCode,
    ])
  })

  test.each(['transport failure', 'rejected authority'] as const)(
    'closes the local-update session after %s',
    async (scenario) => {
      const update = await routeDecodedLocalUpdate(async () =>
        scenario === 'transport failure'
          ? err(
              new ExtensionSessionTransportFailure(
                ExtensionSessionTransportFailureKind.DeliveryFailed,
              ),
            )
          : ok({ kind: 'MissingActiveAuthority' as const }),
      )

      expect(update.response).toEqual({
        ok: false,
        reason: LocalEventLogUpdateFailure.EventLogImportFailed,
      })
      expect(update.closeSession).toHaveBeenCalledTimes(1)
    },
  )

  test('rejects a companion launcher request from an unauthorized external sender', async () => {
    openCompanionLauncher.mockClear()
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const routingArgs = {
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

    expect(await new ExternalCompanionRouter(routingArgs).route()).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'forbidden-sender',
    })
    expect(openCompanionLauncher).not.toHaveBeenCalled()
  })

  test('keeps an authorized external launcher response channel open', async () => {
    openCompanionLauncher.mockClear()
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const routingArgs = {
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

    expect(await new ExternalCompanionRouter(routingArgs).route()).toBe(true)
    await flushResponses()
    expect(openCompanionLauncher).toHaveBeenCalledTimes(1)
    expect(openCompanionLauncher).toHaveBeenCalledWith(
      OpenCompanionLauncherIntent.Default,
    )
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('refreshes cached surfaces after an external pairing import', async () => {
    const importPairingAfterCompanionReady = mock(() =>
      Promise.resolve({ ok: true as const, eventCount: 1 }),
    )
    const refresh = mock(() => Promise.resolve())
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      hasPairingApprovedType: extensionPairingIdentity.hasPairingApprovedType,
      importPairingAfterCompanionReady,
      refreshAuthenticationSurfaces: refresh,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message: { type: 'nook:extension-pairing-approved' },
        sender: {
          id: 'simple-vault',
          url: 'https://simple.example.test/',
        },
        sendResponse,
      }).route(),
    ).toBe(true)
    await flushResponses()
    await flushResponses()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, eventCount: 1 })
  })

  test('reports an external pairing refresh failure', async () => {
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      hasPairingApprovedType: extensionPairingIdentity.hasPairingApprovedType,
      importPairingAfterCompanionReady: () =>
        Promise.resolve({ ok: true as const, eventCount: 1 }),
      refreshAuthenticationSurfaces: () =>
        Promise.reject(new Error('refresh unavailable')),
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message: { type: 'nook:extension-pairing-approved' },
        sender: {
          id: 'simple-vault',
          url: 'https://simple.example.test/',
        },
        sendResponse,
      }).route(),
    ).toBe(true)
    await flushResponses()
    await flushResponses()

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'authentication-surface-refresh-failed',
    })
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

class VaultLaunchCompletion {
  readonly operation: Promise<void>
  complete: () => void = () => {}
  constructor() {
    this.operation = new Promise((resolve) => {
      this.complete = resolve
    })
  }
}

describe('Simple Vault launch routing', () => {
  test('keeps the channel open and responds only after launch completes', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const launch = new VaultLaunchCompletion()
    const sendResponse = mock(() => {})
    expect(
      routeExtensionLifecycleMessage({
        dependencies: {
          ...lifecycleDependencies,
          openSimpleVault: () => launch.operation,
        },
        message: { type: OpenSimpleVaultMessageType.NookOpenSimpleVault },
        sender: { id: 'nook-extension' },
        sendResponse,
      }),
    ).toBe(true)
    await flushResponses()
    expect(sendResponse).not.toHaveBeenCalled()
    launch.complete()
    await flushResponses()
    expect(sendResponse).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('reports launch rejection without an early success response', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    expect(
      routeExtensionLifecycleMessage({
        dependencies: {
          ...lifecycleDependencies,
          openSimpleVault: () => Promise.reject('launch unavailable'),
        },
        message: { type: OpenSimpleVaultMessageType.NookOpenSimpleVault },
        sender: { id: 'nook-extension' },
        sendResponse,
      }),
    ).toBe(true)
    expect(sendResponse).not.toHaveBeenCalled()
    await flushResponses()
    expect(sendResponse).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'launcher-failed',
    })
  })
})
