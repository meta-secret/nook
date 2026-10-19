import { afterEach, describe, expect, test, vi } from 'vitest'
import { validate_reviewed_authenticator_labels } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import type { ReviewedAuthenticatorLabelsVerdictResponse } from '../../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import { ReviewedLabelValidation } from '../../../../nook-web-extension/src/content/reviewed-label-validation'

type LabelsRuntimeRequest = Extract<
  CompanionWasmRuntimeMessage,
  {
    type: CompanionWasmSessionMessageType.ValidateReviewedAuthenticatorLabels
  }
>

type LabelsRuntimeResponse =
  | {
      readonly ok: true
      readonly result: ReviewedAuthenticatorLabelsVerdictResponse
    }
  | { readonly ok: false }

type PendingVerdict = {
  readonly message: LabelsRuntimeRequest
  readonly respond: (response: LabelsRuntimeResponse) => void
}

/** The preview's Service and Account inputs and its Continue button, wired to Rust. */
class LabelGateFixture {
  readonly issuer = document.createElement('input')
  readonly account = document.createElement('input')
  readonly confirm = document.createElement('button')
  readonly pending: PendingVerdict[] = []
  readonly validation: ReviewedLabelValidation

  constructor(defaults: { readonly issuer: string; readonly account: string }) {
    this.issuer.value = defaults.issuer
    this.account.value = defaults.account
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (
          message: LabelsRuntimeRequest,
          respond: (response: LabelsRuntimeResponse) => void,
        ) => {
          expect(message.type).toBe(
            CompanionWasmSessionMessageType.ValidateReviewedAuthenticatorLabels,
          )
          this.pending.push({ message, respond })
        },
      },
    })
    this.validation = new ReviewedLabelValidation({
      browser: globalThis,
      fields: { issuer: this.issuer, account: this.account },
      confirmButton: this.confirm,
    })
  }

  /** Answers one pending request with Rust's verdict on the labels it carried. */
  answer(index: number): void {
    const request = this.pending[index]
    if (!request) throw new Error('No pending label validation.')
    request.respond({
      ok: true,
      result: {
        verdict: validate_reviewed_authenticator_labels(
          request.message.payload,
        ),
      },
    })
  }

  edit(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
}

/** Lets every pending verdict callback run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reviewed authenticator labels', () => {
  test('the prefilled page-host service can be saved once Rust accepts it', async () => {
    const fixture = new LabelGateFixture({
      issuer: 'demo.example.test',
      account: '',
    })
    fixture.validation.start()
    expect(fixture.confirm.disabled).toBe(true)

    fixture.answer(0)

    await vi.waitFor(() => expect(fixture.confirm.disabled).toBe(false))
    expect(fixture.pending[0]?.message.payload).toEqual({
      reviewedIssuer: 'demo.example.test',
      reviewedAccount: '',
    })
  })

  test('an invalid service keeps Continue disabled until it is fixed', async () => {
    const fixture = new LabelGateFixture({ issuer: 'Demo', account: 'demo' })
    fixture.validation.start()
    fixture.answer(0)
    await vi.waitFor(() => expect(fixture.confirm.disabled).toBe(false))

    fixture.edit(fixture.issuer, '   ')
    expect(fixture.confirm.disabled).toBe(true)
    fixture.answer(1)
    await settle()
    expect(fixture.confirm.disabled).toBe(true)

    fixture.edit(fixture.issuer, 'x'.repeat(129))
    fixture.answer(2)
    await settle()
    expect(fixture.confirm.disabled).toBe(true)

    fixture.edit(fixture.issuer, 'Demo Service')
    fixture.answer(3)
    await vi.waitFor(() => expect(fixture.confirm.disabled).toBe(false))
  })

  test('only the latest edit decides, even when an older verdict arrives last', async () => {
    const fixture = new LabelGateFixture({ issuer: 'Demo', account: '' })
    fixture.validation.start()
    fixture.edit(fixture.issuer, '')
    fixture.edit(fixture.issuer, 'Demo Service')

    fixture.answer(2)
    await vi.waitFor(() => expect(fixture.confirm.disabled).toBe(false))
    fixture.answer(1)
    fixture.answer(0)
    await settle()
    expect(fixture.confirm.disabled).toBe(false)
  })

  test('sealing freezes the labels and asks Rust about exactly those values', async () => {
    const fixture = new LabelGateFixture({ issuer: '', account: 'demo' })
    fixture.validation.start()
    fixture.answer(0)

    const sealed = fixture.validation.seal()
    expect(fixture.issuer.readOnly).toBe(true)
    expect(fixture.account.readOnly).toBe(true)
    fixture.answer(1)
    await expect(sealed).resolves.toBe('invalid')
    expect(fixture.confirm.disabled).toBe(true)

    fixture.validation.reopen()
    expect(fixture.issuer.readOnly).toBe(false)
    fixture.edit(fixture.issuer, 'Demo Service')
    fixture.answer(2)
    fixture.answer(3)
    await vi.waitFor(() => expect(fixture.confirm.disabled).toBe(false))
  })

  test('an unavailable runtime keeps Continue disabled', async () => {
    const fixture = new LabelGateFixture({ issuer: 'Demo', account: '' })
    fixture.validation.start()
    fixture.pending[0]?.respond({ ok: false })
    const sealed = fixture.validation.seal()
    fixture.pending[1]?.respond({ ok: false })
    await expect(sealed).resolves.toBe('invalid')
    expect(fixture.confirm.disabled).toBe(true)
  })
})
