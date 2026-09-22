import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import {
  PasswordAuthenticationWorkflowFormSummary,
  type PasswordAuthenticationWorkflowFormSummaryDependencies,
} from '../../nook-web-shared/src/extension/password-authentication-workflow-form-summary'
import { PasswordFormSummaryObservation } from '../../nook-web-shared/src/extension/password-form-summary-observation'
import { PasswordFormScopeKind } from '../../nook-web-shared/src/extension/password-form-fields'
import { initSync } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const originalGlobals = new Map<string, PropertyDescriptor | false>()
const testWindow = new Window()

function installBrowserGlobal<Value>(name: string, value: Value): void {
  originalGlobals.set(
    name,
    Object.getOwnPropertyDescriptor(globalThis, name) || false,
  )
  Object.defineProperty(globalThis, name, { configurable: true, value })
}

beforeAll(() => {
  const wasmInit: Parameters<typeof initSync>[0] = {
    module: readFileSync(
      new URL(
        '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
        import.meta.url,
      ),
    ),
  }
  initSync(wasmInit)
  installBrowserGlobal('CSS', testWindow.CSS)
  installBrowserGlobal('document', testWindow.document)
  installBrowserGlobal('Document', testWindow.Document)
  installBrowserGlobal('Element', testWindow.Element)
  installBrowserGlobal('HTMLElement', testWindow.HTMLElement)
  installBrowserGlobal('HTMLAnchorElement', testWindow.HTMLAnchorElement)
  installBrowserGlobal('HTMLButtonElement', testWindow.HTMLButtonElement)
  installBrowserGlobal('HTMLDialogElement', testWindow.HTMLDialogElement)
  installBrowserGlobal('HTMLFieldSetElement', testWindow.HTMLFieldSetElement)
  installBrowserGlobal('HTMLFormElement', testWindow.HTMLFormElement)
  installBrowserGlobal('HTMLInputElement', testWindow.HTMLInputElement)
  installBrowserGlobal('HTMLLabelElement', testWindow.HTMLLabelElement)
  installBrowserGlobal('HTMLLegendElement', testWindow.HTMLLegendElement)
  installBrowserGlobal('HTMLOptionElement', testWindow.HTMLOptionElement)
  installBrowserGlobal('HTMLSelectElement', testWindow.HTMLSelectElement)
  installBrowserGlobal('HTMLTextAreaElement', testWindow.HTMLTextAreaElement)
  installBrowserGlobal('location', testWindow.location)
  installBrowserGlobal('Node', testWindow.Node)
  installBrowserGlobal('Text', testWindow.Text)
  installBrowserGlobal('window', testWindow)
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function appendLoginForm(id: string, action: string): void {
  const form = testWindow.document.createElement('form')
  form.id = id
  form.setAttribute('action', action)
  const username = testWindow.document.createElement('input')
  username.type = 'email'
  username.name = 'email'
  username.autocomplete = 'username'
  const submit = testWindow.document.createElement('button')
  submit.type = 'submit'
  submit.textContent = 'Sign in'
  form.append(username, submit)
  testWindow.document.body.append(form)
}

describe('authentication workflow shortlist admission', () => {
  test('removes inadmissible destinations before they can crowd out a later login', () => {
    testWindow.document.body.replaceChildren()
    for (let index = 0; index < 40; index += 1) {
      appendLoginForm(
        `oversized-${index}`,
        `https://example.test/login?state=${'a'.repeat(5_000)}`,
      )
    }
    appendLoginForm('valid-login', 'https://example.test/login')

    const summaryObservation = new PasswordFormSummaryObservation(
      testWindow as unknown as typeof globalThis,
    )
    let admissionCount = 0
    const dependencies: PasswordAuthenticationWorkflowFormSummaryDependencies =
      {
        browser: testWindow,
        summarizeRoot:
          summaryObservation.summarizeRoot.bind(summaryObservation),
        observationPriority: () => 0,
        observationIsAdmissible: (observation) => {
          admissionCount += 1
          if (observation.formScope.kind !== PasswordFormScopeKind.Owned)
            return false
          return observation.formScope.owner.id === 'valid-login'
        },
        passkeyControlIsSafe: () => false,
      }
    const observations = new PasswordAuthenticationWorkflowFormSummary(
      dependencies,
    ).summarize()

    expect(admissionCount).toBe(41)
    expect(observations).toHaveLength(1)
    expect(
      observations[0]?.formScope.kind === PasswordFormScopeKind.Owned
        ? observations[0].formScope.owner.id
        : false,
    ).toBe('valid-login')
  })
})
