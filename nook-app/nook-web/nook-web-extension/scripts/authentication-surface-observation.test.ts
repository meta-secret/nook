import { afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { emptyPasswordFormSummary } from '../../nook-web-shared/src/extension/password-form-summary-state'
import {
  PasswordFormScopeKind,
  type PasswordFormObservation,
} from '../../nook-web-shared/src/extension/password-forms'

type SiteMutationBrowserGlobals = Pick<
  Window,
  | 'document'
  | 'Element'
  | 'Node'
  | 'HTMLElement'
  | 'HTMLFormElement'
  | 'MutationObserver'
  | 'NodeFilter'
  | 'HTMLButtonElement'
  | 'HTMLInputElement'
  | 'HTMLLabelElement'
>

await companionWasmReady

/** Renders an owned sign-in form and records the page's next mutations. */
class SiteMutationFixture {
  private readonly previous = {
    document: globalThis.document,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    HTMLFormElement: globalThis.HTMLFormElement,
    MutationObserver: globalThis.MutationObserver,
    NodeFilter: globalThis.NodeFilter,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLLabelElement: globalThis.HTMLLabelElement,
  }
  private readonly browser = new Window()

  install(): this {
    const browser = this.browser
    const installed: SiteMutationBrowserGlobals = {
      document: browser.document,
      Element: browser.Element,
      Node: browser.Node,
      HTMLElement: browser.HTMLElement,
      HTMLFormElement: browser.HTMLFormElement,
      MutationObserver: browser.MutationObserver,
      NodeFilter: browser.NodeFilter,
      HTMLButtonElement: browser.HTMLButtonElement,
      HTMLInputElement: browser.HTMLInputElement,
      HTMLLabelElement: browser.HTMLLabelElement,
    }
    Object.assign(globalThis, installed)
    document.body.innerHTML =
      '<main><form method="post"><input id="usernameEntry" type="email" autocomplete="username webauthn"><button type="submit">Next</button></form></main>'
    return this
  }

  restore(): void {
    Object.assign(globalThis, this.previous)
  }

  workflow(): PasswordFormObservation {
    const form = document.querySelector('form')
    if (!(form instanceof HTMLFormElement)) throw new Error('Expected form')
    return {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: emptyPasswordFormSummary,
    }
  }

  records(mutate: () => void): Promise<MutationRecord[]> {
    const observerOptions: MutationObserverInit = {
      childList: true,
      subtree: true,
    }
    const observed = new Promise<MutationRecord[]>((resolve) => {
      const observer = new MutationObserver((records) => {
        observer.disconnect()
        resolve(records)
      })
      observer.observe(document.documentElement, observerOptions)
    })
    mutate()
    return observed
  }
}

let fixture = new SiteMutationFixture()

afterEach(() => {
  fixture.restore()
})

test('page-level nodes beside a rendered form rescan without remounting it', async () => {
  fixture = new SiteMutationFixture().install()
  const { authenticationSurfaceObservation } =
    await import('../src/content/autofill/authentication-surface-observation')
  type ImpactRequest = Parameters<
    typeof authenticationSurfaceObservation.authenticationMutationImpact
  >[0]
  const host = document.createElement('iframe')
  document.documentElement.append(host)
  const toast = document.createElement('div')
  const removedHost = await fixture.records(() => host.remove())
  const appendedToast = await fixture.records(() => document.body.append(toast))
  for (const records of [removedHost, appendedToast]) {
    const request: ImpactRequest = {
      records,
      mountedHost: false,
      renderedWorkflow: fixture.workflow(),
    }
    expect(
      authenticationSurfaceObservation.authenticationMutationImpact(request)
        .shouldRemountRenderedWorkflow,
    ).toBe(false)
  }
  const form = document.querySelector('form')
  if (!(form instanceof HTMLFormElement)) throw new Error('Expected form')
  const addedControl = await fixture.records(() =>
    form.append(document.createElement('input')),
  )
  const controlRequest: ImpactRequest = {
    records: addedControl,
    mountedHost: false,
    renderedWorkflow: fixture.workflow(),
  }
  expect(
    authenticationSurfaceObservation.authenticationMutationImpact(
      controlRequest,
    ),
  ).toEqual({ shouldRemountRenderedWorkflow: true, shouldScheduleScan: true })
})
