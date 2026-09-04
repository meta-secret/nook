import { afterEach, describe, expect, test, vi } from 'vitest'

const saveMocks = vi.hoisted(() => ({
  sendOffer: vi.fn(async () => ({ kind: 'unavailable' })),
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/login-passkey-actions',
  () => ({
    RuntimeMessageDeliveryKind: { Unavailable: 'unavailable' },
    sendAuthenticationOutcomeRuntimeMessage: vi.fn(),
    sendLoginSaveActionRuntimeMessage: vi.fn(),
    sendLoginSaveOfferRuntimeMessage: saveMocks.sendOffer,
    sendLoginSavePendingRuntimeMessage: vi.fn(),
    sendRuntimeMessageWithoutResponse: vi.fn(),
  }),
)

import { captureSubmittedLogin } from '../../../../nook-web-extension/src/content/autofill/login-save'
import { widgetState } from '../../../../nook-web-extension/src/content/autofill/state'

afterEach(() => {
  document.body.replaceChildren()
  saveMocks.sendOffer.mockClear()
  widgetState.busy = false
})

describe('submitted login capture', () => {
  test('requires an explicit submitter inside the bounded login root', () => {
    document.body.innerHTML = `<form id="aspnetForm" method="post">
      <main class="login-panel"><input autocomplete="username" value="pilot@example.test" /><input type="password" autocomplete="current-password" value="secret" /><button id="local" type="submit">Sign in</button></main>
      <footer><button id="foreign" type="submit">Subscribe</button></footer></form>`
    const form = document.querySelector<HTMLFormElement>('#aspnetForm')
    const local = document.querySelector<HTMLButtonElement>('#local')
    const foreign = document.querySelector<HTMLButtonElement>('#foreign')
    if (!form || !local || !foreign) throw new Error('expected submit fixture')
    form.addEventListener('submit', captureSubmittedLogin)

    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))
    form.dispatchEvent(
      new SubmitEvent('submit', { cancelable: true, submitter: foreign }),
    )
    expect(saveMocks.sendOffer).not.toHaveBeenCalled()

    form.dispatchEvent(
      new SubmitEvent('submit', { cancelable: true, submitter: local }),
    )
    expect(saveMocks.sendOffer).toHaveBeenCalledOnce()
  })

  test('captures unambiguous submitter-null submission for an ordinary form', () => {
    document.body.innerHTML = `<form method="post"><input autocomplete="username" value="pilot@example.test" />
      <input type="password" autocomplete="current-password" value="secret" /></form>`
    const form = document.querySelector('form')
    if (!form) throw new Error('expected ordinary login form')
    form.addEventListener('submit', captureSubmittedLogin)

    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))

    expect(saveMocks.sendOffer).toHaveBeenCalledOnce()
  })
})
