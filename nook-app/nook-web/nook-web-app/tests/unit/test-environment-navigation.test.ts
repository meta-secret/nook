import type DetachedWindowAPI from 'happy-dom/lib/window/DetachedWindowAPI.js'
import type IFetchInterceptor from 'happy-dom/lib/fetch/types/IFetchInterceptor.js'
import { Response as HappyDomResponse } from 'happy-dom'
import { describe, expect, test } from 'vitest'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormInteraction,
} from '../../../nook-web-shared/src/extension/password-forms'
import {
  ExtensionInstallSource,
  extensionInstallationBrowser,
} from '$lib/extension/install'

declare global {
  interface Window {
    readonly happyDOM: DetachedWindowAPI
  }
}

class DomNavigationRequestProbe implements IFetchInterceptor {
  requestCount = 0

  async beforeAsyncRequest(): Promise<HappyDomResponse> {
    this.requestCount += 1
    return new HappyDomResponse('')
  }
}

class DomNavigationSimulation {
  readonly #window: Window
  readonly requestProbe = new DomNavigationRequestProbe()

  constructor(window: Window) {
    this.#window = window
    window.happyDOM.settings.fetch.interceptor = this.requestProbe
  }

  insertFrame(): void {
    const frame = this.#window.document.createElement('iframe')
    frame.src = '/unit-test-frame'
    this.#window.document.body.append(frame)
  }

  submitLoginForm(): FormSubmissionResult {
    this.#window.document.body.innerHTML = `
      <form action="/unit-test-login" method="post">
        <input autocomplete="username" />
        <input autocomplete="current-password" type="password" />
        <button type="submit">Sign in</button>
      </form>
    `
    return passwordFormInteraction.submitLoginForm({
      kind: PasswordFormQueryKind.Root,
      root: this.#window.document,
    })
  }
}

describe('happy-dom unit-test navigation boundary', () => {
  test('does not issue a localhost request when simulated markup inserts a frame', async () => {
    const simulation = new DomNavigationSimulation(window)

    simulation.insertFrame()
    await window.happyDOM.waitUntilComplete()

    expect(simulation.requestProbe.requestCount).toBe(0)
  })

  test('does not issue a localhost request when a simulated form submits', async () => {
    const simulation = new DomNavigationSimulation(window)

    const submission = simulation.submitLoginForm()
    await window.happyDOM.waitUntilComplete()

    expect(submission).toBe(FormSubmissionResult.Submitted)
    expect(simulation.requestProbe.requestCount).toBe(0)
  })

  test('resolves extension metadata fallback without issuing a network request', async () => {
    const simulation = new DomNavigationSimulation(window)

    const target = await extensionInstallationBrowser.loadExtensionInstallTarget()

    expect(target.source).toBe(ExtensionInstallSource.Fallback)
    expect(simulation.requestProbe.requestCount).toBe(0)
  })
})
