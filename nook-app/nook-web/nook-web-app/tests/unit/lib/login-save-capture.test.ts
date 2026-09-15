import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RuntimeMessageDeliveryKind } from '../../../../nook-web-extension/src/content/autofill/login-passkey-actions'

type SendLoginSaveOffer =
  typeof import('../../../../nook-web-extension/src/content/autofill/login-passkey-actions').authenticationRuntimeTransport.sendLoginSaveOfferRuntimeMessage
type SendLoginSavePending =
  typeof import('../../../../nook-web-extension/src/content/autofill/login-passkey-actions').authenticationRuntimeTransport.sendLoginSavePendingRuntimeMessage

const saveMocks = vi.hoisted(() => ({
  sendOffer: vi.fn<SendLoginSaveOffer>(),
  sendPending: vi.fn<SendLoginSavePending>(),
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/login-passkey-actions',
  () => ({
    RuntimeMessageDeliveryKind: {
      Delivered: 'delivered',
      Unavailable: 'unavailable',
    },
    authenticationRuntimeTransport: {
      sendAuthenticationOutcomeRuntimeMessage: vi.fn(),
      sendLoginSaveActionRuntimeMessage: vi.fn(),
      sendLoginSaveOfferRuntimeMessage: saveMocks.sendOffer,
      sendLoginSavePendingRuntimeMessage: saveMocks.sendPending,
      sendRuntimeMessageWithoutResponse: vi.fn(),
    },
  }),
)
import {
  loginSaveInteraction,
  PendingSaveOfferLoadKind,
} from '../../../../nook-web-extension/src/content/autofill/login-save'
import { widgetState } from '../../../../nook-web-extension/src/content/autofill/state'
import { OUTCOME_EVIDENCE_POLL_MS } from '../../../../nook-web-extension/src/content/autofill/workflow-ui'

beforeEach(() => {
  saveMocks.sendOffer.mockResolvedValue({
    kind: RuntimeMessageDeliveryKind.Unavailable,
  })
  saveMocks.sendPending.mockResolvedValue({
    kind: RuntimeMessageDeliveryKind.Unavailable,
  })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
  saveMocks.sendOffer.mockClear()
  saveMocks.sendOffer.mockResolvedValue({
    kind: RuntimeMessageDeliveryKind.Unavailable,
  })
  saveMocks.sendPending.mockClear()
  saveMocks.sendPending.mockResolvedValue({
    kind: RuntimeMessageDeliveryKind.Unavailable,
  })
  widgetState.busy = false
})

describe('submitted login capture', () => {
  test('recovers a save offer staged after the success page performs its first lookup', async () => {
    vi.useFakeTimers()
    document.body.innerHTML =
      '<main data-nook-auth-outcome="success"><p data-testid="mock-auth-success">Authentication complete</p></main>'
    saveMocks.sendPending
      .mockResolvedValueOnce({
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: { ok: true, state: 'unavailable' },
      })
      .mockResolvedValueOnce({
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          ok: true,
          state: 'available',
          offer: {
            offerId: 'navigation-race-offer',
            decision: 0,
            vaultStoreId: 'vault-1',
            vaultName: 'Personal',
          },
        },
      })

    const pendingOffer = loginSaveInteraction.loadPendingSaveOffer()
    await vi.advanceTimersByTimeAsync(OUTCOME_EVIDENCE_POLL_MS)

    await expect(pendingOffer).resolves.toMatchObject({
      kind: PendingSaveOfferLoadKind.Loaded,
      offer: { offerId: 'navigation-race-offer' },
    })
    expect(saveMocks.sendPending).toHaveBeenCalledTimes(2)
  })

  test('does not poll for a pending offer on an authentication form', async () => {
    document.body.innerHTML =
      '<form><input autocomplete="username" /><input type="password" /></form>'
    saveMocks.sendPending.mockResolvedValue({
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { ok: true, state: 'unavailable' },
    })

    await expect(loginSaveInteraction.loadPendingSaveOffer()).resolves.toEqual({
      kind: PendingSaveOfferLoadKind.Absent,
    })
    expect(saveMocks.sendPending).toHaveBeenCalledOnce()
  })

  test('requires an explicit submitter inside the bounded login root', () => {
    document.body.innerHTML = `<form id="aspnetForm" method="post">
      <main class="login-panel"><input autocomplete="username" value="pilot@example.test" /><input type="password" autocomplete="current-password" value="secret" /><button id="local" type="submit">Sign in</button></main>
      <footer><button id="foreign" type="submit">Subscribe</button></footer></form>`
    const form = document.querySelector<HTMLFormElement>('#aspnetForm')
    const local = document.querySelector<HTMLButtonElement>('#local')
    const foreign = document.querySelector<HTMLButtonElement>('#foreign')
    if (!form || !local || !foreign) throw new Error('expected submit fixture')
    form.addEventListener(
      'submit',
      loginSaveInteraction.captureSubmittedLogin.bind(loginSaveInteraction),
    )

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
    form.addEventListener(
      'submit',
      loginSaveInteraction.captureSubmittedLogin.bind(loginSaveInteraction),
    )

    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))

    expect(saveMocks.sendOffer).toHaveBeenCalledOnce()
  })

  test('captures the replacement password on a password-change form', () => {
    document.body.innerHTML = `<form method="post">
      <input autocomplete="username" value="alice@nook.test" />
      <input name="current-password" type="password" autocomplete="current-password" value="old-password" />
      <input name="new-password" type="password" autocomplete="new-password" value="generated-password" />
      <input name="new-password-confirm" type="password" autocomplete="new-password" value="generated-password" />
      <button type="submit">Update password</button>
    </form>`
    const form = document.querySelector('form')
    const submitter = form?.querySelector('button')
    if (!form || !submitter) throw new Error('expected password-change form')
    form.addEventListener(
      'submit',
      loginSaveInteraction.captureSubmittedLogin.bind(loginSaveInteraction),
    )

    form.dispatchEvent(
      new SubmitEvent('submit', { cancelable: true, submitter }),
    )

    expect(saveMocks.sendOffer).toHaveBeenCalledOnce()
    expect(saveMocks.sendOffer.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        username: 'alice@nook.test',
        password: 'generated-password',
      },
    })
  })
})
