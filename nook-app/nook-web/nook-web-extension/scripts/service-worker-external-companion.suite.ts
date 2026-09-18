import { describe, expect, mock, test } from 'bun:test'
import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../nook-web-shared/src/extension/companion-launcher-message'
import type { ExternalCompanionRoutingDependencies } from '../src/background/service-worker/external-companion-routing'
import {
  externalDependencies,
  externalPairingMessage,
  flushResponses,
  lifecycleDependencies,
  openCompanionLauncher,
} from './service-worker-routing-test-support'

describe('external companion routing', () => {
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
