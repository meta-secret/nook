export type ChromeMessage = { message: string }

export type StaticDemoChromeStubArgs = {
  localizedMessages: Record<string, ChromeMessage>
  responsesByType: Record<string, unknown>
  barcodeRawValue?: string
}

/** Self-contained init/evaluate helper for demos with static runtime replies. */
export function installStaticDemoChromeStub(args: StaticDemoChromeStubArgs) {
  type RuntimeMessage = {
    type?: string
    payload?: Record<string, unknown>
  }
  type RuntimeCallback = (response?: unknown) => void

  const { localizedMessages, responsesByType, barcodeRawValue } = args
  const reply = (message: RuntimeMessage): unknown =>
    (message.type && responsesByType[message.type]) || { ok: true }

  if (barcodeRawValue) {
    class FakeBarcodeDetector {
      async detect() {
        return [{ rawValue: barcodeRawValue, format: 'qr_code' }]
      }
    }
    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: FakeBarcodeDetector,
    })
  }

  const chromeStub = {
    i18n: {
      getMessage(key: string, substitution?: string) {
        const message = localizedMessages[key]?.message ?? ''
        return substitution ? message.replaceAll('$1', substitution) : message
      },
    },
    runtime: {
      lastError: undefined,
      getURL(resource: string) {
        return resource === 'icons/nook.png' ? '/favicon.png' : resource
      },
      sendMessage(message: RuntimeMessage, callback?: RuntimeCallback) {
        const response = reply(message)
        if (callback) queueMicrotask(() => callback(response))
      },
    },
    storage: {
      local: {
        get(
          _keys: string | string[] | Record<string, unknown>,
          callback: (items: Record<string, unknown>) => void,
        ) {
          queueMicrotask(() =>
            callback({
              'nook:extension-setup': {
                status: 'ready',
                deviceLabel: 'Demo browser',
                pairedVaults: ['Demo vault'],
                selectedVaultName: 'Demo vault',
                syncProviderCount: 1,
                eventCount: 3,
                eventLogHeads: ['demo-head'],
                lastLocalSyncAt: '2026-07-20T00:00:00.000Z',
              },
            }),
          )
        },
      },
    },
  }

  const browserGlobal = globalThis as typeof globalThis & {
    chrome?: Record<string, unknown>
  }
  if (browserGlobal.chrome) {
    Object.defineProperties(browserGlobal.chrome, {
      i18n: { configurable: true, value: chromeStub.i18n },
      runtime: { configurable: true, value: chromeStub.runtime },
      storage: { configurable: true, value: chromeStub.storage },
    })
  } else {
    Object.defineProperty(browserGlobal, 'chrome', {
      configurable: true,
      value: chromeStub,
    })
  }
}
