import { describe, expect, test } from 'bun:test'
import {
  ExtensionSessionMessageType,
  ExtensionSessionMessageDispatcher,
} from '../src/offscreen/session-message-dispatch'
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

async function decodeProviders(providers: object) {
  return structuredClone(providers) as object as StorageProvider[]
}

describe('ExtensionSessionMessageDispatcher', () => {
  test('stages sensitive fields and clears the caller-owned payload', async () => {
    const payload: Record<string, unknown> = { pin: '123456' }
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
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

  test('rejects non-serialized providers before dispatching a vault import', async () => {
    const providers = [
      {
        githubPat: 'github_pat_rejected_secret',
        metadata: new Date(),
      },
    ]
    const payload: Record<string, unknown> = {
      providers,
    }
    let handled = false
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
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

  test('scrubs an accepted caller provider array after staging', async () => {
    const providers = [{ githubPat: 'github_pat_accepted_secret' }]
    const payload: Record<string, unknown> = { providers }
    let handledGithubPat = ''
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
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
      messagePayload,
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
      payload: { providers: [] },
    })
    const resetResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.Reset,
      payload: {},
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
    ] as object as StorageProvider[]
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
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
      payload: { pin: '123456' },
    })
    const importResponse = dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload: { providers: [{ githubPat: 'caller-secret' }] },
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

  test('cancels a running import when the session generation changes', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const stagedProviders = [
      { githubPat: 'github_pat_expired_staged_secret' },
    ] as object as StorageProvider[]
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
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
      payload: { providers: [{ githubPat: 'caller-secret' }] },
    })
    await Promise.resolve()
    dispatcher.replaceOperations(new Error('session expired'))
    finishDecode(stagedProviders)

    await expect(importResponse).rejects.toThrow('request expired')
    expect(handledTypes).toEqual([])
    expect(stagedProviders[0]).not.toHaveProperty('githubPat')
  })

  test('rejects runtime messages from another extension', () => {
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
      messagePayload,
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
  })
})
