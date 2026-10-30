import { describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../nook-web-shared/src/extension/companion-launcher-message'
import type {
  ExternalCompanionMessage,
  ExternalCompanionRoutingDependencies,
} from '../src/background/service-worker/external-companion-routing'
import { ExtensionKeyringProvidersMessageType } from '../../nook-web-shared/src/extension/keyring-providers-message'
import {
  externalDependencies,
  externalPairingMessage,
  flushResponses,
  lifecycleDependencies,
  openCompanionLauncher,
} from './service-worker-routing-test-support'

describe('external companion routing', () => {
  describe('keyring providers the web app hands over', () => {
    const sharesMessage = {
      type: ExtensionKeyringProvidersMessageType.NookExtensionKeyringProviders,
      payload: { apps: [{ appId: 'app-extension', providers: [] }] },
    }

    async function route(
      takeKeyringProviderShares: ExternalCompanionRoutingDependencies['takeKeyringProviderShares'],
      senderUrl: string,
    ) {
      const dependencies: ExternalCompanionRoutingDependencies = {
        ...externalDependencies,
        takeKeyringProviderShares,
      }
      const { ExternalCompanionRouter } =
        await import('../src/background/service-worker/external-companion-routing')
      const sendResponse = mock(() => {})
      const request: ConstructorParameters<typeof ExternalCompanionRouter>[0] =
        {
          dependencies,
          message: sharesMessage,
          sender: { url: senderUrl },
          sendResponse,
        }
      const accepted = await new ExternalCompanionRouter(request).route()
      await flushResponses()
      return { accepted, sendResponse }
    }

    test('reach Rust from Simple Vault and are acknowledged', async () => {
      const take = mock(() => Promise.resolve(1))
      const { accepted, sendResponse } = await route(
        take,
        'https://simple.example.test/',
      )
      expect(accepted).toBe(true)
      expect(take).toHaveBeenCalledWith(sharesMessage.payload)
      expect(sendResponse).toHaveBeenCalledWith({ ok: true })
    })

    test('from another origin are refused before Rust sees them', async () => {
      const take = mock(() => Promise.resolve(1))
      const { accepted, sendResponse } = await route(
        take,
        'https://foreign.example/',
      )
      expect(accepted).toBe(false)
      expect(take).not.toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        reason: 'forbidden-sender',
      })
    })

    test('that Rust refuses are reported as not taken', async () => {
      const take = mock(() => Promise.reject(new Error('plaintext')))
      const { sendResponse } = await route(take, 'https://simple.example.test/')
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        reason: 'keyring-providers-not-taken',
      })
    })
  })

  test('exports the requested vault only after approved external-origin admission', async () => {
    const response = { kind: 'NotPaired' as const }
    const exportEvents = mock(() => Effect.succeed(response))
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      vaultEventLogExporter: { run: exportEvents },
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const message = {
      type: 'ExportVaultEventLog',
      payload: { vault_store_id: 'store_abcdefghijk' },
    }
    const request: ConstructorParameters<typeof ExternalCompanionRouter>[0] = {
      dependencies,
      message,
      sender: { url: 'https://simple.example.test/' },
      sendResponse,
    }
    expect(await new ExternalCompanionRouter(request).route()).toBe(true)
    await flushResponses()
    expect(exportEvents).toHaveBeenCalledWith(message)
    expect(sendResponse).toHaveBeenCalledWith(response)
  })

  test('rejects an encrypted-event export from a foreign origin before opening the extension vault', async () => {
    const response = { kind: 'NotPaired' as const }
    const exportEvents = mock(() => Effect.succeed(response))
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      vaultEventLogExporter: { run: exportEvents },
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const request: ConstructorParameters<typeof ExternalCompanionRouter>[0] = {
      dependencies,
      message: {
        type: 'ExportVaultEventLog',
        payload: { vault_store_id: 'store_abcdefghijk' },
      },
      sender: { url: 'https://foreign.example/' },
      sendResponse,
    }
    expect(await new ExternalCompanionRouter(request).route()).toBe(false)
    expect(exportEvents).not.toHaveBeenCalled()
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'forbidden-sender',
    })
  })

  test('removes page-supplied identity and grant fields before resolving stored authority', async () => {
    const response = { kind: 'NotPaired' as const }
    const exportEvents = mock(() => Effect.succeed(response))
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      vaultEventLogExporter: { run: exportEvents },
    }
    const { ExternalCompanionRouter } =
      await import('../src/background/service-worker/external-companion-routing')
    const sendResponse = mock(() => {})
    const request: ConstructorParameters<typeof ExternalCompanionRouter>[0] = {
      dependencies,
      message: {
        type: 'ExportVaultEventLog',
        payload: {
          vault_store_id: 'store_abcdefghijk',
          app_id: 'page-authority',
          app_public_key: 'page-encryption-key',
          app_signing_public_key: 'page-signing-key',
          grant: { vaultStoreId: 'store_other', deviceId: 'page-device' },
        },
      },
      sender: { url: 'https://simple.example.test/' },
      sendResponse,
    }
    const accepted = await new ExternalCompanionRouter(request).route()
    await flushResponses()
    const canonicalRequest = {
      type: 'ExportVaultEventLog',
      payload: { vault_store_id: 'store_abcdefghijk' },
    }
    expect(exportEvents).toHaveBeenCalledWith(canonicalRequest)
    expect(exportEvents).toHaveBeenCalledTimes(1)
    expect(accepted).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith(response)
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
    const decodeOpenCompanionLauncherMessage = mock(
      externalDependencies.decodeOpenCompanionLauncherMessage,
    )
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      decodePairingApprovedMessage,
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
    expect(decodeOpenCompanionLauncherMessage).not.toHaveBeenCalled()
    expect(importPairingAfterCompanionReady).not.toHaveBeenCalled()
  })

  type PairingRejection = {
    readonly name: string
    readonly payload: ExternalCompanionMessage
    readonly reason: string
  }
  const pairingRejections: PairingRejection[] = [
    {
      name: 'scope',
      payload: { ...externalPairingMessage.payload, scopes: ['vault-admin'] },
      reason: 'invalid-pairing-grant-scopes',
    },
    {
      name: 'provider hand-off',
      payload: Object.fromEntries(
        Object.entries(externalPairingMessage.payload).filter(
          ([field]) => field !== 'providers',
        ),
      ),
      reason: 'invalid-pairing-grant-providers',
    },
    {
      name: 'keyring log',
      payload: { ...externalPairingMessage.payload, identityEvents: [] },
      reason: 'invalid-pairing-grant-keyring',
    },
    {
      name: 'keyring vault',
      payload: {
        ...externalPairingMessage.payload,
        vaults: [{ storeId: 'store_abcdefghijk', eventLogRecords: [] }],
      },
      reason: 'invalid-pairing-grant-keyring',
    },
  ]
  test.each(pairingRejections)(
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
    const returnToConnectOrigin = mock(() => Promise.resolve())
    const dependencies: ExternalCompanionRoutingDependencies = {
      ...externalDependencies,
      importPairingAfterCompanionReady,
      refreshAuthenticationSurfaces: refresh,
      returnToConnectOrigin,
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

    // The admitted keyring approval reaches the import as it arrived.
    expect(importPairingAfterCompanionReady).toHaveBeenCalledWith(
      externalPairingMessage,
    )
    expect(refresh).toHaveBeenCalledTimes(1)
    // The tab whose widget started the connect regains focus after approval.
    expect(returnToConnectOrigin).toHaveBeenCalledTimes(1)
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
