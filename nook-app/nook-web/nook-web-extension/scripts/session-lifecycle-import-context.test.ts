import { expect, test } from 'bun:test'

type RuntimeMessageEventFixture = typeof chrome.runtime.onMessage & {
  listeners: Array<
    Parameters<typeof chrome.runtime.onMessage.addListener>[0]
  >
}

test('loads account pickers with the extension test runtime installed', async () => {
  Object.assign(globalThis, {
    __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
  })
  const runtimeMessages =
    chrome.runtime.onMessage as RuntimeMessageEventFixture
  const initialListenerCount = runtimeMessages.listeners.length

  const { accountPickerSessions } =
    await import('../src/background/service-worker/account-pickers')

  expect(accountPickerSessions).toBeDefined()
  expect(runtimeMessages.listeners).toHaveLength(initialListenerCount + 1)
})

test('registers readiness on an explicit host and still requires Chrome', async () => {
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
  Object.assign(globalThis, { chrome: browserHost })

  const lifecycle = new ExtensionSessionLifecycle()
  expect(lifecycle).toBeInstanceOf(ExtensionSessionLifecycle)
  expect(listeners).toHaveLength(1)

  Reflect.deleteProperty(globalThis, 'chrome')
  try {
    expect(() => new ExtensionSessionLifecycle()).toThrow(ReferenceError)
  } finally {
    Object.assign(globalThis, { chrome: browserHost })
  }
})
