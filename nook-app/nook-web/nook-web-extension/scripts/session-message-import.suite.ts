import { err, ok } from 'neverthrow'
import { describe, expect, test } from 'bun:test'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
  githubProvider,
  parseExtensionSessionRequest,
  sessionMessageWireFixture,
  vaultImportRequest,
  type StorageProvider,
} from './session-message-dispatch-test-support'

describe('ExtensionSessionMessageDispatcher vault import', () => {
  test('stages provider credentials before awaiting cold WASM', async () => {
    const providers = [
      {
        id: 'github',
        type: 'github' as const,
        label: 'GitHub',
        githubPat: {
          state: 'token' as const,
          value: '-----BEGIN AGE ENCRYPTED FILE-----\nfixture',
        },
        githubRepo: { state: 'defaultRepository' as const },
        oauthFile: { state: 'notApplicable' as const },
        localFolder: { state: 'notApplicable' as const },
        storeId: { state: 'unscoped' as const },
        syncCheckpoint: { state: 'neverSynced' as const },
        createdAt: '2026-06-24T00:00:00.000Z',
      },
    ]
    const payload = {
      vaultStoreId: 'store_abcdefghijk',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      providers,
      eventLogRecords: [],
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    const parsing = parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.ImportVault,
      payload,
    })

    expect(payload.providers).not.toHaveProperty('0.githubPat.value')
    expect(providers[0]).toHaveProperty('githubPat.state', 'missing')
    const parsed = await parsing
    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
  })

  test('rejects non-serialized providers before dispatching a vault import', async () => {
    const providers = [
      {
        githubPat: 'github_pat_rejected_secret',
        metadata: new Date(),
      },
    ]
    const admission = BrowserRuntimeMessage.from({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })

    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Rejected)
    expect(providers[0]?.githubPat).toBe('github_pat_rejected_secret')
  })

  test('rejects a vault import without a provider array', async () => {
    const response = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: 'missing-array',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })

    expect(response.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
  })

  test('scrubs an accepted caller provider array after staging', async () => {
    const providers = [githubProvider('github_pat_accepted_secret')]
    const payload = {
      providers,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    let handledGithubPat = ''
    const dispatcher = new ExtensionSessionMessageDispatcher({
      handleCompanionIdentityDiscovery: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      handleCompanionIdentityHandoff: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      decodeProviders,
      handleMessage: async (message) => {
        if (message.type === ExtensionSessionMessageType.ImportVault) {
          const handledProviders = sessionMessageWireFixture.providers(message)
          const provider = handledProviders[0]
          if (
            provider &&
            typeof provider === 'object' &&
            'githubPat' in provider
          ) {
            const githubPat = provider.githubPat
            if (
              githubPat &&
              typeof githubPat === 'object' &&
              'state' in githubPat &&
              githubPat.state === 'token' &&
              'value' in githubPat
            ) {
              handledGithubPat = String(githubPat.value)
            }
          }
        }
        return ok({ ok: true })
      },
    })

    const request = vaultImportRequest(payload.providers, payload.queue)
    const response = dispatcher.enqueue(request)

    expect(request.payload.providers).toEqual([])
    expect(payload.providers).toHaveLength(1)
    expect(payload.providers).not.toHaveProperty('0.githubPat.value')
    expect(providers[0]?.githubPat.state).toBe('missing')
    expect(await response).toEqual(ok({ ok: true }))
    expect(handledGithubPat).toBe('github_pat_accepted_secret')
  })

  test('reserves import ordering before provider decoding completes', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      handleCompanionIdentityDiscovery: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      handleCompanionIdentityHandoff: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        handledTypes.push(type)
        if (type === ExtensionSessionMessageType.Reset) {
          dispatcher.replaceOperations(
            new SessionOperationFailure(SessionOperationFailureKind.Closed),
          )
        }
        return ok({ ok: true })
      },
    })

    const importResponse = dispatcher.enqueue(vaultImportRequest([]))
    const resetResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.Reset,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    await Promise.resolve()
    expect(handledTypes).toEqual([])

    finishDecode([])
    expect(await importResponse).toEqual(ok({ ok: true }))
    expect(await resetResponse).toEqual(ok({ ok: true }))
    expect(handledTypes).toEqual([
      ExtensionSessionMessageType.ImportVault,
      ExtensionSessionMessageType.Reset,
    ])
  })

  test('scrubs decoded provider credentials when a pending import is canceled', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    let releaseBlocker: () => void = () => {
      throw new Error('queue blocker was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const stagedProviders = [
      githubProvider('github_pat_canceled_staged_secret'),
    ]
    const dispatcher = new ExtensionSessionMessageDispatcher({
      handleCompanionIdentityDiscovery: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      handleCompanionIdentityHandoff: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        if (type === ExtensionSessionMessageType.CreatePin) await blocker
        return ok({ ok: true })
      },
    })

    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const importResponse = dispatcher.enqueue(
      vaultImportRequest([githubProvider('caller-secret')]),
    )

    dispatcher.replaceOperations(
      new SessionOperationFailure(SessionOperationFailureKind.Closed),
    )
    finishDecode(stagedProviders)
    expect(await importResponse).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Closed)),
    )
    await decodedProviders
    await Promise.resolve()
    expect(stagedProviders[0]?.githubPat).toEqual({ state: 'missing' })

    releaseBlocker()
    expect(await blockerResponse).toEqual(ok({ ok: true }))
  })

  test('honors a vault-import deadline and scrubs expired staging', async () => {
    let releaseBlocker: () => void = () => {
      throw new Error('queue blocker was not initialized')
    }
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const stagedProviders = [githubProvider('github_pat_expired_queue_secret')]
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      handleCompanionIdentityDiscovery: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      handleCompanionIdentityHandoff: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      decodeProviders: async () => stagedProviders,
      handleMessage: async (message) => {
        handledTypes.push(message.type)
        if (message.type === ExtensionSessionMessageType.CreatePin) {
          await blocker
        }
        return ok({ ok: true })
      },
    })

    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const importResponse = dispatcher.enqueue(
      vaultImportRequest([githubProvider('caller-secret')], {
        kind: 'deadline',
        expiresAt: Date.now() + 10,
        priority: 'interactive',
      }),
    )
    const importSettlement = importResponse

    await Bun.sleep(20)
    releaseBlocker()
    expect(await blockerResponse).toEqual(ok({ ok: true }))
    expect(await importSettlement).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Expired)),
    )
    await Promise.resolve()
    expect(handledTypes).toEqual([ExtensionSessionMessageType.CreatePin])
    expect(stagedProviders[0]?.githubPat).toEqual({ state: 'missing' })
  })
})
