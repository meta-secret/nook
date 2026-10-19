import { Exit, Schema } from 'effect'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import {
  ReviewedAuthenticatorLabelsVerdictDecoder,
  type ReviewedAuthenticatorLabelsVerdictResponse,
} from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import type { NookReviewedAuthenticatorLabelsVerdict } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ReviewedLabelFields } from './enrollment-flow-view'

/** The preview's editable labels and the action they gate. */
export type ReviewedLabelGateRequest = {
  readonly browser: typeof globalThis
  readonly fields: ReviewedLabelFields
  readonly confirmButton: HTMLButtonElement
}

enum ReviewedLabelEditing {
  /** The user may edit; each edit asks Rust again. */
  Open = 'open',
  /** The labels are frozen while a validated pair is being staged. */
  Sealed = 'sealed',
}

type VerdictDecodeOutcome = {
  readonly onFailure: () => NookReviewedAuthenticatorLabelsVerdict
  readonly onSuccess: (
    response: ReviewedAuthenticatorLabelsVerdictResponse,
  ) => NookReviewedAuthenticatorLabelsVerdict
}

/**
 * Keeps the enrollment action disabled until Rust says the reviewed Service
 * and Account would save, so a label can never fail after the site enabled
 * 2FA. Only the latest edit's verdict applies; an unavailable runtime or an
 * unreadable reply counts as invalid.
 */
export class ReviewedLabelValidation {
  private generation = 0
  private editing = ReviewedLabelEditing.Open
  private readonly invalidVerdict: NookReviewedAuthenticatorLabelsVerdict =
    'invalid'
  private readonly verdictOutcome: VerdictDecodeOutcome = {
    onFailure: () => this.invalidVerdict,
    onSuccess: ({ verdict }) => verdict,
  }

  constructor(private readonly request: ReviewedLabelGateRequest) {}

  /** Validates the prefilled labels now and again after every edit. */
  start(): void {
    const { fields } = this.request
    for (const input of [fields.issuer, fields.account]) {
      input.addEventListener('input', () => {
        switch (this.editing) {
          case ReviewedLabelEditing.Open:
            void this.refresh()
            return
          case ReviewedLabelEditing.Sealed:
            return
        }
      })
    }
    void this.refresh()
  }

  /**
   * Freezes the labels and returns Rust's verdict on exactly the values that
   * will be staged. Pending edit verdicts no longer change the action.
   */
  async seal(): Promise<NookReviewedAuthenticatorLabelsVerdict> {
    this.applyEditing(ReviewedLabelEditing.Sealed)
    this.generation += 1
    return this.verdict()
  }

  /** Reopens editing after a sealed pair turned out invalid. */
  reopen(): void {
    this.applyEditing(ReviewedLabelEditing.Open)
    void this.refresh()
  }

  private async refresh(): Promise<void> {
    this.generation += 1
    const generation = this.generation
    this.request.confirmButton.disabled = true
    const verdict = await this.verdict()
    switch (generation === this.generation) {
      case false:
        return
      case true:
        break
    }
    switch (verdict) {
      case 'valid':
        this.request.confirmButton.disabled = false
        return
      case 'invalid':
        this.request.confirmButton.disabled = true
        return
    }
  }

  private async verdict(): Promise<NookReviewedAuthenticatorLabelsVerdict> {
    const { browser, fields } = this.request
    const message: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ValidateReviewedAuthenticatorLabels,
      payload: {
        reviewedIssuer: fields.issuer.value,
        reviewedAccount: fields.account.value,
      },
      origin: browser.location.origin,
    }
    const delivery = await sendCompanionWasmRuntimeMessage(browser, message)
    switch (delivery.kind) {
      case CompanionWasmRuntimeDeliveryKind.Unavailable:
        return this.invalidVerdict
      case CompanionWasmRuntimeDeliveryKind.Delivered:
        return Exit.match(
          Schema.decodeUnknownExit(ReviewedAuthenticatorLabelsVerdictDecoder)(
            delivery.response,
          ),
          this.verdictOutcome,
        )
    }
  }

  /** Sealed labels are read-only, so the staged pair is the validated one. */
  private applyEditing(editing: ReviewedLabelEditing): void {
    this.editing = editing
    const readOnly = editing === ReviewedLabelEditing.Sealed
    this.request.fields.issuer.readOnly = readOnly
    this.request.fields.account.readOnly = readOnly
  }
}
