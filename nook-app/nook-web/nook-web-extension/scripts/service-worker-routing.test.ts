import { describe, expect, test } from 'bun:test'
import type { routeExtensionLifecycleMessage as RouteExtensionLifecycleMessage } from '../src/background/service-worker/extension-lifecycle-routing'
import type { routeExternalCompanionMessage as RouteExternalCompanionMessage } from '../src/background/service-worker/external-companion-routing'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
globalThis.chrome = {
  runtime: {
    id: 'nook-extension',
    getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
  },
} as typeof chrome

describe('service worker trust routing', () => {
  test('rejects an internal session command from a foreign sender synchronously', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const responses: string[] = []
    const routingArgs: Parameters<typeof RouteExtensionLifecycleMessage>[0] = {
      message: { type: 'nook:ensure-extension-session-runtime' },
      sender: { id: 'foreign-extension' },
      sendResponse: (response) => responses.push(JSON.stringify(response)),
    }
    const result = routeExtensionLifecycleMessage(routingArgs)

    expect(result).toBe(false)
    const expectedResponse = { ok: false, reason: 'forbidden-sender' }
    expect(responses).toEqual([JSON.stringify(expectedResponse)])
  })

  test('rejects a companion launcher request from an unauthorized external sender', async () => {
    const { routeExternalCompanionMessage } =
      await import('../src/background/service-worker/external-companion-routing')
    const responses: string[] = []
    const routingArgs: Parameters<typeof RouteExternalCompanionMessage>[0] = {
      message: { type: 'nook:open-companion-launcher' },
      sender: { id: 'foreign-extension', url: 'https://example.com' },
      sendResponse: (response) => responses.push(JSON.stringify(response)),
    }
    const result = routeExternalCompanionMessage(routingArgs)

    expect(result).toBe(false)
    const expectedResponse = { ok: false, reason: 'forbidden-sender' }
    expect(responses).toEqual([JSON.stringify(expectedResponse)])
  })
})
