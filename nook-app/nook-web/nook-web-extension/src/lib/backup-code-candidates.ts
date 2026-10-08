/* eslint-disable nook-typed-api/no-raw-object-arguments -- Candidate observations are assembled into a Rust-generated request at this adapter boundary. */
import {
  authentication_recovery_copy_evidence,
  type AuthenticationRecoveryCopyEvidence,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  CompanionWasmBackupCodeExtractionDecoder,
  type CompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { Effect, Schema } from 'effect'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'

import { authenticationSubmissionControls } from '../../../nook-web-shared/src/extension/password-form-submission-controls'

const MAX_RECOVERY_SOURCE_TEXT_UNITS = 256

const MAX_RECOVERY_COPY_ELEMENTS = 128

type RecoveryCopyTexts = string[]

type RecoveryCopyEvidence = AuthenticationRecoveryCopyEvidence

enum RecoveryCopyCollectionScope {
  Instructions = 'instructions',
  ApprovedExcerpt = 'approved-excerpt',
}

type RecoveryCopyCollectionRequest = { scope: RecoveryCopyCollectionScope }

const recoverySecretElementSelector =
  'p, code, pre, kbd, samp, li, [role="listitem"], input, textarea, select, button, [role="textbox"], [contenteditable], [hidden], [aria-hidden="true"], [data-nook-otpauth-uri], [data-nook-backup-codes], [data-nook-backup-code], [data-secret], [data-setup-key]'

export type DocumentBackupCodeCandidates = string[]

/** Owns this browser host’s resources and interaction lifecycle. */
class RecoveryCopyObservation {
  private evidence: RecoveryCopyEvidence = { copy: '', hint: 'absent' }

  constructor(private readonly browser: typeof globalThis) {}

  private isVisibleRecoveryCopy(element: HTMLElement): boolean {
    if (!authenticationSubmissionControls.isRenderedControl(element))
      return false
    let current = element
    while (true) {
      if (current.getAttribute('aria-hidden') === 'true') return false
      const parent = current.parentElement
      if (!parent) break
      current = parent
    }
    return true
  }

  private recoveryTexts({
    scope,
  }: RecoveryCopyCollectionRequest): RecoveryCopyTexts {
    const texts: RecoveryCopyTexts = []
    const selector =
      scope === RecoveryCopyCollectionScope.Instructions
        ? 'h1, h2, h3, h4, h5, h6, [role="heading"], label, legend'
        : 'h1, h2, h3, h4, h5, h6, [role="heading"], p, label, legend, button, li, code, pre'
    const elements =
      this.browser.document.querySelectorAll<HTMLElement>(selector)
    for (const element of elements) {
      if (texts.length >= MAX_RECOVERY_COPY_ELEMENTS) break
      if (!this.isVisibleRecoveryCopy(element)) continue
      if (
        scope === RecoveryCopyCollectionScope.Instructions &&
        (element.closest(recoverySecretElementSelector) ||
          element.querySelector(recoverySecretElementSelector))
      )
        continue
      const text = ((v) => (v ? v : ''))(element.textContent)
      if (text.length > MAX_RECOVERY_SOURCE_TEXT_UNITS) continue
      texts.push(text)
    }
    return texts
  }

  async prepareAuthenticationRecoveryEvidence(): Promise<void> {
    const collection: RecoveryCopyCollectionRequest = {
      scope: RecoveryCopyCollectionScope.Instructions,
    }
    const delivery = await sendCompanionWasmRuntimeMessage(this.browser, {
      type: CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence,
      payload: { texts: this.recoveryTexts(collection) },
      origin: this.browser.location.origin,
    })
    if (
      delivery.kind === CompanionWasmRuntimeDeliveryKind.Delivered &&
      delivery.response &&
      typeof delivery.response === 'object' &&
      'copy' in delivery.response &&
      'hint' in delivery.response
    ) {
      this.evidence = delivery.response
      return
    }
    throw new Error('Recovery instruction observation runtime unavailable.')
  }

  private currentEvidence(): RecoveryCopyEvidence {
    if (typeof chrome === 'object' && Boolean(chrome.runtime?.id)) {
      return this.evidence
    }
    const collection: RecoveryCopyCollectionRequest = {
      scope: RecoveryCopyCollectionScope.Instructions,
    }
    return authentication_recovery_copy_evidence({
      texts: this.recoveryTexts(collection),
    })
  }

  authenticationRecoveryEvidence(): RecoveryCopyEvidence {
    return this.currentEvidence()
  }

  authenticationRecoveryCopy(): string {
    return this.authenticationRecoveryEvidence().copy
  }

  recoveryCopyHasBackupCodeHint(recoveryCopy: string): boolean {
    const evidence = this.currentEvidence()
    return recoveryCopy === evidence.copy && evidence.hint === 'present'
  }

  pageHasDocumentBackupCodeHint(): boolean {
    return this.currentEvidence().hint === 'present'
  }

  extractDocumentBackupCodeCandidates(sourceText?: string): Promise<string[]> {
    const browser = this.browser
    const collection: RecoveryCopyCollectionRequest = {
      scope: RecoveryCopyCollectionScope.ApprovedExcerpt,
    }
    const request: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates,
      origin: this.browser.location.origin,
      payload: {
        text: ((...[text = this.recoveryTexts(collection).join('\n')]) => text)(
          sourceText,
        ),
      },
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const delivery = yield* Effect.tryPromise(() =>
          sendCompanionWasmRuntimeMessage(browser, request),
        )
        if (delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered)
          return yield* Effect.fail(
            new Error('Backup code extraction runtime unavailable.'),
          )
        const result = yield* Schema.decodeUnknownEffect(
          CompanionWasmBackupCodeExtractionDecoder,
        )(delivery.response)
        return result.codes
      }),
    )
  }

  clearBackupCodeCandidates(codes: DocumentBackupCodeCandidates): void {
    for (let index = 0; index < codes.length; index += 1) {
      codes[index] = ''
    }
  }
}

export const recoveryCopyObservation = new RecoveryCopyObservation(globalThis)
