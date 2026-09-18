import { err, ok } from 'neverthrow'
import { describe, expect, test } from 'bun:test'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import {
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  ExtensionSessionRequestParseKind,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
  parseExtensionSessionRequest,
  sessionMessageWireFixture,
  type NookVaultManager,
} from './session-message-dispatch-test-support'

describe('ExtensionSessionMessageDispatcher control ingress', () => {
  test('routes grant authority through runtime ingress and the owned queue', async () => {
    type RuntimeListener = Parameters<
      typeof chrome.runtime.onMessage.addListener
    >[0]
    const registered = Promise.withResolvers<RuntimeListener>()
    const blocked = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const events: string[] = []
    const classifiedInputs: { stored: string; vault: string }[] = []
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          id: 'nook-extension',
          getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
          onMessage: { addListener: registered.resolve },
        },
      },
    })
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { classifySessionGrantAuthority } =
      await import('../src/offscreen/session-operations')
    const manager = {
      classify_extension_grant_authority: (
        stored: Parameters<
          NookVaultManager['classify_extension_grant_authority']
        >[0],
        vault: Parameters<
          NookVaultManager['classify_extension_grant_authority']
        >[1],
      ) => {
        expect(events).toEqual([
          'block-started',
          'block-finished',
          'interactive',
        ])
        classifiedInputs.push({ stored, vault: String(vault) })
        events.push('classified')
        return { kind: 'NoMatchingAuthority' as const }
      },
    }
    const stagedPayloads: { stored_json: string }[] = []
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
        if (message.type === ExtensionSessionMessageType.MigrateAuthProviders) {
          events.push('interactive')
          return ok({ kind: 'NoMatchingAuthority' as const })
        }
        if (message.type === ExtensionSessionMessageType.Status) {
          events.push('block-started')
          started.resolve()
          await blocked.promise
          events.push('block-finished')
          return ok({ kind: 'NoMatchingAuthority' as const })
        }
        if (message.type !== ExtensionSessionMessageType.ClassifyGrantAuthority)
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        stagedPayloads.push(message.payload)
        return ok(
          classifySessionGrantAuthority({
            manager,
            payload: message.payload,
          }),
        )
      },
    })
    chrome.runtime.onMessage.addListener(dispatcher.listener())
    const listener = await registered.promise
    const queued = Promise.withResolvers<void>()
    const enqueue = dispatcher.enqueue.bind(dispatcher)
    dispatcher.enqueue = (message) => {
      const result = enqueue(message)
      if (message.type === ExtensionSessionMessageType.ClassifyGrantAuthority)
        queued.resolve()
      return result
    }
    const pending = dispatcher.enqueue({
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    await started.promise
    const payload = {
      stored_json: '{}',
      vault_store_id: 'store_abcdefghijk',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
    const response = Promise.withResolvers<unknown>()
    expect(
      Boolean(
        listener(
          { type: ExtensionSessionMessageType.ClassifyGrantAuthority, payload },
          { id: 'nook-extension' },
          response.resolve,
        ),
      ),
    ).toBe(true)
    await queued.promise
    expect(events).toEqual(['block-started'])
    const interactive = dispatcher.enqueue({
      type: ExtensionSessionMessageType.MigrateAuthProviders,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    blocked.resolve()
    await pending
    await interactive
    expect(await response.promise).toEqual({ kind: 'NoMatchingAuthority' })
    expect(events).toEqual([
      'block-started',
      'block-finished',
      'interactive',
      'classified',
    ])
    expect(payload.stored_json).toBe('')
    expect(stagedPayloads).toHaveLength(1)
    expect(classifiedInputs).toEqual([
      { stored: '{}', vault: 'store_abcdefghijk' },
    ])
    const [stagedPayload] = stagedPayloads
    if (!stagedPayload) throw new Error('dispatcher must stage one payload')
    expect(stagedPayload.stored_json).toBe('')
  })
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
      vaultStoreId: 'store_abcdefghijk',
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
    expect(payload).toHaveProperty('codes', [])
  })
  test('rejects malformed provider and event-log elements at Rust ingress', async () => {
    const grant = {
      vaultStoreId: 'store_abcdefghijk',
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
        vaultStoreId: 'store_abcdefghijk',
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
      githubPat: {
        state: 'token',
        value: '-----BEGIN AGE ENCRYPTED FILE-----\nfixture',
      },
      githubRepo: { state: 'defaultRepository' },
      oauthFile: { state: 'notApplicable' },
      localFolder: { state: 'notApplicable' },
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-08-10T00:00:00Z',
    }
    const message = {
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        vaultStoreId: 'store_abcdefghijk',
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
    if (parse.request.type !== ExtensionSessionMessageType.ImportVault) {
      throw new Error('expected a parsed vault import')
    }
    const stagedProvider = parse.request.payload.providers[0]
    if (!stagedProvider) throw new Error('expected a staged provider')
    expect(stagedProvider.label).toBe('Personal GitHub')
    expect(stagedProvider.githubPat).toEqual({
      state: 'token',
      value: '-----BEGIN AGE ENCRYPTED FILE-----\nfixture',
    })
    expect(provider).toHaveProperty('githubPat.state', 'missing')
  })
  test('stages sensitive fields and clears the caller-owned payload', async () => {
    const payload = {
      pin: '123456',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    }
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
      handleMessage: async (message) =>
        ok({
          pin: sessionMessageWireFixture.pin(message),
        }),
    })
    const response = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload,
    })
    expect(payload.pin).toBe('')
    expect(await response).toEqual(ok({ pin: '123456' }))
  })
  test('keeps a login-save plan after its submitting document navigates', async () => {
    const payload = {
      vaultStoreId: 'store_abcdefghijk',
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
    payload.origin = 'https://navigated.example.com'
    const parsed = await parsing
    expect(parsed.kind).toBe(ExtensionSessionRequestParseKind.Parsed)
    if (parsed.kind === ExtensionSessionRequestParseKind.Parsed) {
      expect(sessionMessageWireFixture.loginSave(parsed.request).username).toBe(
        'alice',
      )
      expect(sessionMessageWireFixture.loginSave(parsed.request).password).toBe(
        'password',
      )
      expect(sessionMessageWireFixture.loginSave(parsed.request).origin).toBe(
        'https://example.com',
      )
    }
  })
  test('rejects a missing queue before staging and clears browser-owned secrets', async () => {
    const payload = {
      vaultStoreId: 'store_abcdefghijk',
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
        vaultStoreId: 'store_abcdefghijk',
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
        expect(
          sessionMessageWireFixture.passkeyRequestJson(parsed.request),
        ).toBe('{"challenge":"browser-owned-secret"}')
      }
    }
  })
  test('rejects an expired request before WASM validation and clears secrets', async () => {
    const payload = {
      vaultStoreId: 'store_abcdefghijk',
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
        handledTypes.push(message.type)
        if (message.type === ExtensionSessionMessageType.CreatePin)
          await blocker
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
    const ceremonyResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.RegisterPasskey,
      payload: {
        vaultStoreId: 'store_abcdefghijk',
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
    const ceremonySettlement = ceremonyResponse

    await Bun.sleep(20)
    releaseBlocker()
    expect(await blockerResponse).toEqual(ok({ ok: true }))
    expect(await ceremonySettlement).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Expired)),
    )
    expect(handledTypes).toEqual([ExtensionSessionMessageType.CreatePin])
  })
})
