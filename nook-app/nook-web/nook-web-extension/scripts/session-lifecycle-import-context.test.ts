import { expect, test } from 'bun:test'

type RuntimeMessageEventFixture = typeof chrome.runtime.onMessage & {
  listeners: Array<
    Parameters<typeof chrome.runtime.onMessage.addListener>[0]
  >
}

const preloadedChromeHost = globalThis.chrome

test('loads account pickers with isolated Chrome hosts', async () => {
  Object.assign(globalThis, {
    __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    chrome: preloadedChromeHost,
  })
  const runtimeMessages =
    preloadedChromeHost.runtime.onMessage as RuntimeMessageEventFixture
  const initialListenerCount = runtimeMessages.listeners.length

  const { accountPickerSessions } =
    await import('../src/background/service-worker/account-pickers')

  expect(accountPickerSessions.loginAccountsForOrigin).toBeInstanceOf(Function)
  expect(runtimeMessages.listeners).toHaveLength(initialListenerCount + 1)

  const { ExtensionSessionLifecycle } =
    await import('../src/background/service-worker/session-lifecycle')
  const listeners: Array<
    Parameters<typeof chrome.runtime.onMessage.addListener>[0]
  > = []
  const browserHost = {
    runtime: {
      onMessage: {
        addListener(
          listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
        ): void {
          listeners.push(listener)
        },
      },
    },
  }
  try {
    Object.assign(globalThis, { chrome: browserHost })

    const lifecycle = new ExtensionSessionLifecycle()
    expect(lifecycle).toBeInstanceOf(ExtensionSessionLifecycle)
    expect(listeners).toHaveLength(1)

    Reflect.deleteProperty(globalThis, 'chrome')
    expect(() => new ExtensionSessionLifecycle()).toThrow(ReferenceError)
  } finally {
    Object.assign(globalThis, { chrome: preloadedChromeHost })
  }

  expect(globalThis.chrome).toBe(preloadedChromeHost)
})
