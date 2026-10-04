type RuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

const sessionReadinessListeners: Array<RuntimeMessageListener> = []

export const extensionTestBrowserHost = {
  runtime: {
    onMessage: {
      listeners: sessionReadinessListeners,
      addListener(listener: RuntimeMessageListener): void {
        sessionReadinessListeners.push(listener)
      },
    },
  },
}

Object.assign(globalThis, { chrome: extensionTestBrowserHost })

// Register the owned session listener before tests install narrower Chrome hosts.
await import('../src/background/service-worker/session-lifecycle')
