import type DetachedWindowAPI from 'happy-dom/lib/window/DetachedWindowAPI.js'
import type IFetchInterceptor from 'happy-dom/lib/fetch/types/IFetchInterceptor.js'
import { Response as HappyDomResponse } from 'happy-dom'
import { describe, expect, test } from 'vitest'
import {
  ExtensionInstallSource,
  extensionInstallationBrowser,
} from '$lib/extension/install'

declare global {
  interface Window {
    readonly happyDOM: DetachedWindowAPI
  }
}

class NetworkRequestProbe implements IFetchInterceptor {
  requestCount = 0

  async beforeAsyncRequest(): Promise<HappyDomResponse> {
    this.requestCount += 1
    return new HappyDomResponse('')
  }
}

class ExtensionMetadataSimulation {
  readonly requestProbe = new NetworkRequestProbe()

  constructor(window: Window) {
    window.happyDOM.settings.fetch.interceptor = this.requestProbe
  }
}

describe('happy-dom unit-test network boundary', () => {
  test('resolves extension metadata fallback without issuing a network request', async () => {
    const simulation = new ExtensionMetadataSimulation(window)

    const target = await extensionInstallationBrowser.loadExtensionInstallTarget()

    expect(target.source).toBe(ExtensionInstallSource.Fallback)
    expect(simulation.requestProbe.requestCount).toBe(0)
  })
})
