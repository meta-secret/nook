import type DetachedWindowAPI from 'happy-dom/lib/window/DetachedWindowAPI.js'
import type IFetchInterceptor from 'happy-dom/lib/fetch/types/IFetchInterceptor.js'
import { Response as HappyDomResponse } from 'happy-dom'
import { describe, expect, test } from 'vitest'

declare global {
  interface Window {
    readonly happyDOM: DetachedWindowAPI
  }
}

class DomFrameRequestProbe implements IFetchInterceptor {
  requestCount = 0

  async beforeAsyncRequest(): Promise<HappyDomResponse> {
    this.requestCount += 1
    return new HappyDomResponse('')
  }
}

class DomFrameSimulation {
  readonly #window: Window
  readonly requestProbe = new DomFrameRequestProbe()

  constructor(window: Window) {
    this.#window = window
    window.happyDOM.settings.fetch.interceptor = this.requestProbe
  }

  insertFrame(): void {
    const frame = this.#window.document.createElement('iframe')
    frame.src = '/unit-test-frame'
    this.#window.document.body.append(frame)
  }
}

describe('happy-dom unit-test navigation boundary', () => {
  test('does not issue a localhost request when simulated markup inserts a frame', () => {
    const simulation = new DomFrameSimulation(window)

    simulation.insertFrame()

    expect(simulation.requestProbe.requestCount).toBe(0)
  })
})
