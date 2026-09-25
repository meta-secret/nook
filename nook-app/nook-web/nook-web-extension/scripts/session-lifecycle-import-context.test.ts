import { expect, test } from 'bun:test'

enum ChromeHostAtTestEntryKind {
  Present = 'present',
  Missing = 'missing',
}

type ChromeHostAtTestEntry =
  | {
      readonly kind: ChromeHostAtTestEntryKind.Present
      readonly host: typeof chrome
    }
  | { readonly kind: ChromeHostAtTestEntryKind.Missing }

test('loads account pickers with isolated Chrome hosts', async () => {
  let chromeAtTestEntry: ChromeHostAtTestEntry
  switch (Object.hasOwn(globalThis, 'chrome')) {
    case true:
      chromeAtTestEntry = {
        kind: ChromeHostAtTestEntryKind.Present,
        host: globalThis.chrome,
      }
      break
    case false:
      chromeAtTestEntry = { kind: ChromeHostAtTestEntryKind.Missing }
      break
  }

  const accountPickerListeners: Array<
    Parameters<typeof chrome.runtime.onMessage.addListener>[0]
  > = []
  const accountPickerHost = {
    runtime: {
      onMessage: {
        listeners: accountPickerListeners,
        addListener(
          listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
        ): void {
          accountPickerListeners.push(listener)
        },
      },
    },
  }
  try {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
      chrome: accountPickerHost,
    })

    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')

    expect(accountPickerSessions.loginAccountsForOrigin).toBeInstanceOf(Function)
    expect(accountPickerListeners).toHaveLength(1)

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
    expect(() => new ExtensionSessionLifecycle()).toThrow(ReferenceError)
  } finally {
    switch (chromeAtTestEntry.kind) {
      case ChromeHostAtTestEntryKind.Present:
        Object.assign(globalThis, { chrome: chromeAtTestEntry.host })
        break
      case ChromeHostAtTestEntryKind.Missing:
        Reflect.deleteProperty(globalThis, 'chrome')
        break
    }
  }

  switch (chromeAtTestEntry.kind) {
    case ChromeHostAtTestEntryKind.Present:
      expect(globalThis.chrome).toBe(chromeAtTestEntry.host)
      break
    case ChromeHostAtTestEntryKind.Missing:
      expect(Object.hasOwn(globalThis, 'chrome')).toBe(false)
      break
  }
})
