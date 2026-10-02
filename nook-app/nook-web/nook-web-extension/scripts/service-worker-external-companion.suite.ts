import { describe, expect, mock, spyOn, test } from 'bun:test'
import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../nook-web-shared/src/extension/companion-launcher-message'
import { ExtensionPairedVaultUnlockRequestMessageType } from '../../nook-web-shared/src/extension/runtime-messages'
import {
  ExternalSenderTrustDecision,
  ExternalSenderTrustPolicy,
} from '../src/background/service-worker/routing-trust'
import type { ExternalCompanionRoutingDependencies } from '../src/background/service-worker/external-companion-routing'
import {
  externalDependencies,
  externalPairingMessage,
  flushResponses,
  lifecycleDependencies,
  openCompanionLauncher,
} from './service-worker-routing-test-support'

function pairedVaultUnlockSender(): chrome.runtime.MessageSender {
  return {
    url: 'https://simple.example.test/',
    tab: {
      id: 3,
      index: 0,
      pinned: false,
      highlighted: true,
      windowId: 42,
      active: true,
      frozen: false,
      incognito: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      lastAccessed: 0,
    },
  }
}

describe('external companion routing', () => {
  test('opens the trusted paired-unlock side panel synchronously from its sender window', async () => {
    const operations: string[] = []
    const open = mock(() => {
      operations.push('open-panel')
      return Promise.resolve()
    })
    const close = mock(() => Promise.resolve())
    Object.assign(chrome, { sidePanel: { open, close } })
    const admitSynchronously = mock(() => {
      operations.push('admit-sender')
      return ExternalSenderTrustDecision.Admitted
    })
    const requestPairedVaultUnlock = mock(
      async ({
        message,
      }: Parameters<
        typeof externalDependencies.requestPairedVaultUnlock
      >[0]) => {
        operations.push('request-vault-unlock')
        return {
          ok: true as const,
          requestId: message.payload.requestId,
          vaultStoreId: message.payload.vaultStoreId,
        }
      },
    )
    const asyncAdmission = spyOn(
      ExternalSenderTrustPolicy,
      'admits',
    ).mockImplementation(async () => {
      operations.push('async-admit')
      return false
    })
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      admitsUnlockSenderSynchronously: admitSynchronously,
      requestPairedVaultUnlock,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const message = {
      type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
      payload: { requestId: 'request-1', vaultStoreId: 'store_abcdefghijk' },
    }
    try {
      const route = new ExternalCompanionRouter({
        dependencies,
        message,
        sender: pairedVaultUnlockSender(),
        sendResponse,
      }).route()

      expect(open).toHaveBeenCalledWith({ windowId: 42 })
      expect(operations).toEqual([
        'admit-sender',
        'open-panel',
        'request-vault-unlock',
      ])
      expect(await route).toBe(true)
      await flushResponses()
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        requestId: 'request-1',
        vaultStoreId: 'store_abcdefghijk',
      })
      expect(asyncAdmission).not.toHaveBeenCalled()
    } finally {
      asyncAdmission.mockRestore()
    }
  })

  test('fails closed before opening a panel when synchronous trust is not ready', async () => {
    const open = mock(() => Promise.resolve())
    const close = mock(() => Promise.resolve())
    Object.assign(chrome, { sidePanel: { open, close } })
    const admitSynchronously = mock(() => ExternalSenderTrustDecision.NotReady)
    const decodeUnlock = mock(
      externalDependencies.decodeExtensionPairedVaultUnlockRequestMessage,
    )
    const requestPairedVaultUnlock = mock(
      externalDependencies.requestPairedVaultUnlock,
    )
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      admitsUnlockSenderSynchronously: admitSynchronously,
      decodeExtensionPairedVaultUnlockRequestMessage: decodeUnlock,
      requestPairedVaultUnlock,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message: {
          type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
          payload: {
            requestId: 'request-2',
            vaultStoreId: 'store_abcdefghijk',
          },
        },
        sender: pairedVaultUnlockSender(),
        sendResponse,
      }).route(),
    ).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'unlock-trust-policy-not-ready',
    })
    expect(open).not.toHaveBeenCalled()
    expect(decodeUnlock).not.toHaveBeenCalled()
    expect(requestPairedVaultUnlock).not.toHaveBeenCalled()
  })

  test('passes the decoded new-device identity handoff wire request unchanged', async () => {
    const createIdentityHandoff = mock(() =>
      Promise.resolve({
        ok: true as const,
        envelope: 'sealed',
        nextNonce: 'next',
      }),
    )
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      createIdentityHandoff,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const message = {
      type: 'nook:extension-identity-handoff-request' as const,
      payload: {
        recipientPublicKey: 'age1recipient',
        nonce: 'handoff-nonce',
        expectedDeviceId: 'device-id',
        expectedDevicePublicKey: 'age1device',
        expectedDeviceSigningPublicKey: 'signing-key',
      },
    }

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message,
        sender: { url: 'https://simple.example.test/' },
        sendResponse,
      }).route(),
    ).toBe(true)
    await flushResponses()

    expect(createIdentityHandoff).toHaveBeenCalledTimes(1)
    expect(createIdentityHandoff).toHaveBeenCalledWith(message)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      envelope: 'sealed',
      nextNonce: 'next',
    })
  })

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

  test('rejects an unauthorized malformed payload before decoding', async () => {
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const importPairingAfterCompanionReady = mock(() =>
      Promise.resolve({ ok: true as const, eventCount: 1 }),
    )
    const decodePairingApprovedMessage = mock(
      externalDependencies.decodePairingApprovedMessage,
    )
    const decodeExtensionIdentityHandoffRequestMessage = mock(
      externalDependencies.decodeExtensionIdentityHandoffRequestMessage,
    )
    const decodeExtensionPairedVaultIdentityDiscoveryMessage = mock(
      externalDependencies.decodeExtensionPairedVaultIdentityDiscoveryMessage,
    )
    const decodeExtensionPairedVaultIdentityHandoffRequestMessage = mock(
      externalDependencies.decodeExtensionPairedVaultIdentityHandoffRequestMessage,
    )
    const decodeExtensionPairedVaultUnlockRequestMessage = mock(
      externalDependencies.decodeExtensionPairedVaultUnlockRequestMessage,
    )
    const decodeOpenCompanionLauncherMessage = mock(
      externalDependencies.decodeOpenCompanionLauncherMessage,
    )
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      decodePairingApprovedMessage,
      decodeExtensionIdentityHandoffRequestMessage,
      decodeExtensionPairedVaultIdentityDiscoveryMessage,
      decodeExtensionPairedVaultIdentityHandoffRequestMessage,
      decodeExtensionPairedVaultUnlockRequestMessage,
      decodeOpenCompanionLauncherMessage,
      importPairingAfterCompanionReady,
    }
    const routingRequest: ConstructorParameters<
      typeof ExternalCompanionRouter
    >[0] = {
      dependencies,
      message: { malformed: { payload: 'not-a-runtime-message' } },
      sender: {
        id: 'foreign-extension',
        url: 'https://example.com/',
      },
      sendResponse,
    }

    expect(await new ExternalCompanionRouter(routingRequest).route()).toBe(
      false,
    )
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'forbidden-sender',
    })
    expect(decodePairingApprovedMessage).not.toHaveBeenCalled()
    expect(decodeExtensionIdentityHandoffRequestMessage).not.toHaveBeenCalled()
    expect(
      decodeExtensionPairedVaultIdentityDiscoveryMessage,
    ).not.toHaveBeenCalled()
    expect(
      decodeExtensionPairedVaultIdentityHandoffRequestMessage,
    ).not.toHaveBeenCalled()
    expect(
      decodeExtensionPairedVaultUnlockRequestMessage,
    ).not.toHaveBeenCalled()
    expect(decodeOpenCompanionLauncherMessage).not.toHaveBeenCalled()
    expect(importPairingAfterCompanionReady).not.toHaveBeenCalled()
  })

  test.each([
    {
      name: 'vault type',
      payload: { ...externalPairingMessage.payload, vaultType: 'sentinel' },
      reason: 'invalid-pairing-grant-vault-type',
    },
    {
      name: 'provider payload',
      payload: {
        ...externalPairingMessage.payload,
        providers: [{ githubPat: 'malformed-secret' }] as {
          githubPat: string
        }[],
      },
      reason: 'invalid-pairing-grant-providers',
    },
  ])(
    'preserves the specific pairing rejection for an invalid $name',
    async ({ payload, reason }) => {
      const { ExternalCompanionRouter } =
        await import('../src/background/service-worker/external-companion-routing')
      const sendResponse = mock(() => {})
      const message = { ...externalPairingMessage, payload }

      expect(
        await new ExternalCompanionRouter({
          dependencies: externalDependencies,
          message,
          sender: {
            id: 'simple-vault',
            url: 'https://simple.example.test/',
          },
          sendResponse,
        }).route(),
      ).toBe(false)
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason })
    },
  )

  test('reports event-log import failure for a valid grant with invalid event records', async () => {
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const message = { ...externalPairingMessage, eventLogRecords: [] }

    expect(
      await new ExternalCompanionRouter({
        dependencies: externalDependencies,
        message,
        sender: {
          id: 'simple-vault',
          url: 'https://simple.example.test/',
        },
        sendResponse,
      }).route(),
    ).toBe(false)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'event-log-import-failed',
    })
  })

  test('keeps an authorized external launcher response channel open', async () => {
    openCompanionLauncher.mockClear()
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const { ExtensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')
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
    expect(openCompanionLauncher).toHaveBeenCalledWith({
      intent: OpenCompanionLauncherIntent.Default,
      source: ExtensionSessionLifecycle.directEntrySource(),
    })
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('refreshes cached surfaces after an external pairing import', async () => {
    const importPairingAfterCompanionReady = mock(() =>
      Promise.resolve({ ok: true as const, eventCount: 1 }),
    )
    const refresh = mock(() => Promise.resolve())
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      importPairingAfterCompanionReady,
      refreshAuthenticationSurfaces: refresh,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message: externalPairingMessage,
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

  test('preserves a committed external pairing import when surface refresh fails', async () => {
    const refresh = mock(() => Promise.reject(new Error('refresh unavailable')))
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      importPairingAfterCompanionReady: () =>
        Promise.resolve({ ok: true as const, eventCount: 1 }),
      refreshAuthenticationSurfaces: refresh,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message: externalPairingMessage,
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

  test('preserves an external pairing rejection without refreshing surfaces', async () => {
    const refresh = mock(() => Promise.resolve())
    const rejection = {
      ok: false as const,
      reason: 'event-log-access-not-granted',
    }
    const importPairingAfterCompanionReady = mock(() =>
      Promise.resolve(rejection),
    )
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      importPairingAfterCompanionReady,
      refreshAuthenticationSurfaces: refresh,
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})

    expect(
      await new ExternalCompanionRouter({
        dependencies,
        message: externalPairingMessage,
        sender: {
          id: 'simple-vault',
          url: 'https://simple.example.test/',
        },
        sendResponse,
      }).route(),
    ).toBe(true)
    await flushResponses()
    await flushResponses()

    expect(importPairingAfterCompanionReady).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    expect(sendResponse).toHaveBeenCalledWith(rejection)
  })

  test('normalizes pair intent before internal launcher routing', async () => {
    openCompanionLauncher.mockClear()
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const { ExtensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')
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
    expect(openCompanionLauncher).toHaveBeenCalledWith({
      intent: OpenCompanionLauncherIntent.Pair,
      source: ExtensionSessionLifecycle.directEntrySource(),
    })
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })
})
