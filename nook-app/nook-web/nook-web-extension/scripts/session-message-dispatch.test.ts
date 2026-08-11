import { describe, expect, test } from 'bun:test'
import {
  ExtensionSessionMessageType,
  ExtensionSessionMessageDispatcher,
} from '../src/offscreen/session-message-dispatch'
import {
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  parseExtensionSessionRequest,
} from '../src/offscreen/session-request-adapter'
import type { StorageProvider } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

function messagePayload(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== 'object' || !('payload' in message)) {
    return {}
  }
  const payload = message.payload
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {}
}

async function decodeProviders(providers: StorageProvider[]) {
  return structuredClone(providers)
}

describe('ExtensionSessionMessageDispatcher', () => {
  test('accepts explicit default queue state for control commands', async () => {
    for (const type of [
      ExtensionSessionMessageType.MigrateAuthProviders,
      ExtensionSessionMessageType.Reset,
      ExtensionSessionMessageType.Status,
    ]) {
      const message = {
        type,
        payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
      }
      const parse = await parseExtensionSessionRequest(message)
      expect(parse.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    }
  })

  test('rejects payloadless control commands at browser ingress', async () => {
    const message = {
      type: ExtensionSessionMessageType.Status,
    }
    const parse = await parseExtensionSessionRequest(message)
    expect(parse.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
  })

  test('rejects malformed backup codes without normalizing them into an empty replacement', async () => {
    const payload = {
      origin: 'https://example.com',
      vaultStoreId: 'vault',
      secretId: 'authenticator',
      codes: { malformed: true },
      mode: 'replace',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    const parse = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.AuthenticatorBackupAttach,
      payload,
    })

    expect(parse.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
    expect(payload.codes).toEqual([])
  })

  test('rejects malformed provider and event-log elements at Rust ingress', async () => {
    const grant = {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
    }
    const malformedProvider = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        ...grant,
        providers: [{ githubPat: 'secret' }],
        eventLogRecords: [],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    expect(malformedProvider.kind).toBe(
      ExtensionSessionRequestParseKind.Invalid,
    )

    const malformedEvent = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.UpdateVault,
      payload: {
        ...grant,
        eventLogRecords: [{ eventId: 'event' }],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    expect(malformedEvent.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
  })

  test('accepts complete vault events at Rust ingress', async () => {
    const message = {
      type: ExtensionSessionMessageType.UpdateVault,
      payload: {
        vaultStoreId: 'vault',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        eventLogRecords: [
          {
            eventId: 'event',
            path: 'path',
            event: {
              schema_version: 2,
              store_id: 'store_testtoken11',
              actor_id: `key_${'0'.repeat(64)}`,
              actor_signing_public_key: '0'.repeat(64),
              parents: [],
              created_at: '2026-08-10T00:00:00Z',
              key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
              operations: [{ type: 'vault-cleared' }],
              signature: `ed25519:${'0'.repeat(128)}`,
            },
          },
        ],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const parse = await parseExtensionSessionRequest(message)
    expect(parse.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
  })

  test('validates a credential-safe provider identity without discarding metadata', async () => {
    const provider = {
      id: 'github',
      type: 'github',
      label: 'Personal GitHub',
      githubPat: { state: 'token', value: 'secret' },
      githubRepo: { state: 'defaultRepository' },
      oauthFile: { state: 'notApplicable' },
      localFolder: { state: 'notApplicable' },
      storeId: { state: 'unscoped' },
      createdAt: '2026-08-10T00:00:00Z',
    }
    const message = {
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        vaultStoreId: 'vault',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        providers: [provider],
        eventLogRecords: [],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }

    const parse = await parseExtensionSessionRequest(message)

    expect(parse.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    if (parse.kind !== ExtensionSessionRequestParseKind.Parsed) return
    const stagedProvider = parse.request.payload.providers[0] as StorageProvider
    expect(stagedProvider.label).toBe('Personal GitHub')
    expect(stagedProvider.githubPat).toEqual({
      state: 'token',
      value: 'secret',
    })
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })

  test('stages sensitive fields and clears the caller-owned payload', async () => {
    const payload: Record<string, unknown> = {
      pin: '123456',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async (message) => ({
        pin: messagePayload(message).pin,
      }),
    })

    const response = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload,
    })

    expect(payload.pin).toBe('')
    await expect(response).resolves.toEqual({ pin: '123456' })
  })

  test('stages browser-owned secrets before awaiting cold WASM', async () => {
    const payload = {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      origin: 'https://example.com',
      username: 'alice',
      password: 'password',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    const parsing = parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.PlanLoginSave,
      payload,
    })

    expect(payload.username).toBe('')
    expect(payload.password).toBe('')
    const parsed = await parsing
    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    if (parsed.kind === ExtensionSessionRequestParseKind.Parsed) {
      expect(messagePayload(parsed.request).username).toBe('alice')
      expect(messagePayload(parsed.request).password).toBe('password')
    }
  })

  test('rejects a missing queue before staging and clears browser-owned secrets', async () => {
    const payload = {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      origin: 'https://example.com',
      username: 'alice',
      password: 'password',
    }

    const parsed = await parseExtensionSessionRequest({
      type: ExtensionSessionMessageType.PlanLoginSave,
      payload,
    })

    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
    expect(payload.username).toBe('')
    expect(payload.password).toBe('')
  })

  test('stages passkey request JSON before awaiting cold WASM', async () => {
    for (const type of [
      ExtensionSessionMessageType.RegisterPasskey,
      ExtensionSessionMessageType.AssertPasskey,
    ]) {
      const payload = {
        vaultStoreId: 'vault',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        requestId: 'request',
        requestJson: '{"challenge":"browser-owned-secret"}',
        queue: {
          kind: 'deadline' as const,
          expiresAt: Date.now() + 5_000,
          priority: 'interactive' as const,
        },
      }
      const parsing = parseExtensionSessionRequest({ type, payload })

      expect(payload.requestJson).toBe('')
      const parsed = await parsing
      expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
      if (parsed.kind === ExtensionSessionRequestParseKind.Parsed) {
        expect(messagePayload(parsed.request).requestJson).toBe(
          '{"challenge":"browser-owned-secret"}',
        )
      }
    }
  })

  test('rejects an expired request before WASM validation and clears secrets', async () => {
    const payload = {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      origin: 'https://example.com',
      username: 'alice',
      password: 'password',
      queue: {
        kind: 'deadline' as const,
        expiresAt: Date.now() - 1,
        priority: 'interactive' as const,
      },
    }

    const request = {
      type: ExtensionSessionMessageType.PlanLoginSave,
      payload,
    }
    const parsed = await parseExtensionSessionRequest(request)

    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Invalid)
    expect(payload.username).toBe('')
    expect(payload.password).toBe('')
  })

  test('preserves a staged passkey ceremony deadline while queued', async () => {
    let releaseBlocker: () => void = () => {
      throw new Error('queue blocker was not initialized')
    }
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async (message) => {
        handledTypes.push(message.type)
        if (message.type === ExtensionSessionMessageType.CreatePin)
          await blocker
        return { ok: true }
      },
    })
    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const ceremonyResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.RegisterPasskey,
      payload: {
        vaultStoreId: 'vault',
        deviceId: 'device',
        devicePublicKey: 'public',
        deviceSigningPublicKey: 'signing',
        requestId: 'request',
        requestJson: '{"challenge":"short-lived"}',
        queue: {
          kind: 'deadline',
          expiresAt: Date.now() + 10,
          priority: 'interactive',
        },
      },
    })
    const ceremonyRejection = expect(ceremonyResponse).rejects.toThrow(
      'EXTENSION_SESSION_REQUEST_EXPIRED',
    )

    await Bun.sleep(20)
    releaseBlocker()
    await expect(blockerResponse).resolves.toEqual({ ok: true })
    await ceremonyRejection
    expect(handledTypes).toEqual([ExtensionSessionMessageType.CreatePin])
  })

  test('stages provider credentials before awaiting cold WASM', async () => {
    const providers = [
      {
        id: 'provider',
        type: 'github' as const,
        githubPat: 'github_pat_browser_owned_secret',
      },
    ]
    const payload = {
      vaultStoreId: 'vault',
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

    expect(payload.providers).toEqual([])
    expect(providers[0]).not.toHaveProperty('githubPat')
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
    const payload: Record<string, unknown> = {
      providers,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    let handled = false
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async () => {
        handled = true
        return { ok: true }
      },
    })

    const response = await dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload,
    })

    expect(response).toEqual({
      ok: false,
      error: 'invalid-provider-payload',
    })
    expect(handled).toBe(false)
    expect(payload.providers).toEqual([])
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('rejects a vault import without a provider array', async () => {
    const payload: Record<string, unknown> = {
      providers: 'missing-array',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    let handled = false
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async () => {
        handled = true
        return { ok: true }
      },
    })

    const response = await dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload,
    })

    expect(response).toEqual({
      ok: false,
      error: 'invalid-provider-payload',
    })
    expect(handled).toBe(false)
    expect(payload.providers).toEqual([])
  })

  test('scrubs an accepted caller provider array after staging', async () => {
    const providers = [{ githubPat: 'github_pat_accepted_secret' }]
    const payload: Record<string, unknown> = {
      providers,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    let handledGithubPat = ''
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async (message) => {
        const handledProviders = messagePayload(message).providers
        if (Array.isArray(handledProviders)) {
          const provider = handledProviders[0]
          if (
            provider &&
            typeof provider === 'object' &&
            'githubPat' in provider
          ) {
            handledGithubPat = String(provider.githubPat)
          }
        }
        return { ok: true }
      },
    })

    const response = dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload,
    })

    expect(payload.providers).toEqual([])
    expect(providers[0]).not.toHaveProperty('githubPat')
    await expect(response).resolves.toEqual({ ok: true })
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
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        handledTypes.push(type)
        if (type === ExtensionSessionMessageType.Reset) {
          dispatcher.replaceOperations(new Error('reset'))
        }
        return { ok: true }
      },
    })

    const importResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: [],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const resetResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.Reset,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    await Promise.resolve()
    expect(handledTypes).toEqual([])

    finishDecode([])
    await expect(importResponse).resolves.toEqual({ ok: true })
    await expect(resetResponse).resolves.toEqual({ ok: true })
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
      { githubPat: 'github_pat_canceled_staged_secret' },
    ] as StorageProvider[]
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        if (type === ExtensionSessionMessageType.CreatePin) await blocker
        return { ok: true }
      },
    })

    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const importResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: [{ githubPat: 'caller-secret' }],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })

    dispatcher.replaceOperations(new Error('reset'))
    finishDecode(stagedProviders)
    await expect(importResponse).rejects.toThrow('reset')
    await decodedProviders
    await Promise.resolve()
    expect(stagedProviders[0]).not.toHaveProperty('githubPat')

    releaseBlocker()
    await expect(blockerResponse).resolves.toEqual({ ok: true })
  })

  test('honors a vault-import deadline and scrubs expired staging', async () => {
    let releaseBlocker: () => void = () => {
      throw new Error('queue blocker was not initialized')
    }
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const stagedProviders = [
      { githubPat: 'github_pat_expired_queue_secret' },
    ] as StorageProvider[]
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: async () => stagedProviders,
      handleMessage: async (message) => {
        handledTypes.push(message.type)
        if (message.type === ExtensionSessionMessageType.CreatePin) {
          await blocker
        }
        return { ok: true }
      },
    })

    const blockerResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload: {
        pin: '123456',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    const importResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: [{ githubPat: 'caller-secret' }],
        queue: {
          kind: 'deadline',
          expiresAt: Date.now() + 10,
          priority: 'interactive',
        },
      },
    })
    const importRejection = expect(importResponse).rejects.toThrow(
      'EXTENSION_SESSION_REQUEST_EXPIRED',
    )

    await Bun.sleep(20)
    releaseBlocker()
    await expect(blockerResponse).resolves.toEqual({ ok: true })
    await importRejection
    await Promise.resolve()
    expect(handledTypes).toEqual([ExtensionSessionMessageType.CreatePin])
    expect(stagedProviders[0]).not.toHaveProperty('githubPat')
  })

  test('cancels a running import when the session generation changes', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const stagedProviders = [
      { githubPat: 'github_pat_expired_staged_secret' },
    ] as StorageProvider[]
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        handledTypes.push(type)
        return { ok: true }
      },
    })

    const importResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        providers: [{ githubPat: 'caller-secret' }],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    })
    await Promise.resolve()
    dispatcher.replaceOperations(new Error('session expired'))
    finishDecode(stagedProviders)

    await expect(importResponse).rejects.toThrow('request expired')
    expect(handledTypes).toEqual([])
    expect(stagedProviders[0]).not.toHaveProperty('githubPat')
  })

  test('rejects foreign and malformed runtime messages without hanging', async () => {
    type RuntimeListener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean
    enum ListenerRegistrationKind {
      NotRegistered = 'not-registered',
      Registered = 'registered',
    }

    type ListenerRegistration =
      | { kind: ListenerRegistrationKind.NotRegistered }
      | { kind: ListenerRegistrationKind.Registered; listener: RuntimeListener }
    let registration: ListenerRegistration = {
      kind: ListenerRegistrationKind.NotRegistered,
    }
    globalThis.chrome = {
      runtime: {
        id: 'nook-extension',
        getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
        onMessage: {
          addListener: (registered: RuntimeListener) => {
            registration = {
              kind: ListenerRegistrationKind.Registered,
              listener: registered,
            }
          },
        },
      },
    } as typeof chrome
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async () => ({ ok: true }),
    })
    dispatcher.registerRuntimeListener()

    if (registration.kind === ListenerRegistrationKind.NotRegistered) {
      throw new Error('runtime listener was not registered')
    }
    expect(
      registration.listener(
        { type: ExtensionSessionMessageType.Status },
        { id: 'other-extension' },
        () => {},
      ),
    ).toBe(false)

    let unrelatedMessageResponded = false
    const unrelatedMessage = { type: 'nook:website-login-options' }
    const sameExtensionSender: chrome.runtime.MessageSender = {
      id: 'nook-extension',
    }
    const unrelatedResponse = () => {
      unrelatedMessageResponded = true
    }
    expect(
      registration.listener(
        unrelatedMessage,
        sameExtensionSender,
        unrelatedResponse,
      ),
    ).toBe(false)
    await Promise.resolve()
    expect(unrelatedMessageResponded).toBe(false)

    let lockMessageResponded = false
    const lockResponse = () => {
      lockMessageResponded = true
    }
    expect(
      registration.listener(
        { type: ExtensionSessionMessageType.Lock },
        sameExtensionSender,
        lockResponse,
      ),
    ).toBe(false)
    await Promise.resolve()
    expect(lockMessageResponded).toBe(false)

    const malformedResponse = new Promise<unknown>((resolve) => {
      const sender: chrome.runtime.MessageSender = { id: 'nook-extension' }
      const keepsResponseChannelOpen = registration.listener(
        { type: ExtensionSessionMessageType.Status },
        sender,
        resolve,
      )
      expect(keepsResponseChannelOpen).toBe(true)
    })
    await expect(malformedResponse).resolves.toEqual({
      ok: false,
      error: 'Invalid extension session request.',
    })
  })
})
