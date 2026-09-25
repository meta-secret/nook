type RuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

const sessionReadinessListeners: Array<RuntimeMessageListener> = []

Object.assign(globalThis, {
  chrome: {
    runtime: {
      onMessage: {
        listeners: sessionReadinessListeners,
        addListener(listener: RuntimeMessageListener): void {
          sessionReadinessListeners.push(listener)
        },
      },
    },
  },
})
