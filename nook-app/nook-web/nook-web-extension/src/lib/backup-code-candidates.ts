/* eslint-disable nook-typed-api/no-raw-object-arguments -- Candidate observations are assembled into a Rust-generated request at this adapter boundary. */
import {
  authentication_recovery_copy_evidence,
  extract_backup_code_candidates,
  type AuthenticationRecoveryCopyEvidence,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { CompanionWasmSessionMessageType } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'

import { authenticationSubmissionControls } from '../../../nook-web-shared/src/extension/password-form-submission-controls'

const MAX_RECOVERY_SOURCE_TEXT_UNITS = 256

const MAX_RECOVERY_COPY_ELEMENTS = 128

type RecoveryCopyTexts = string[]

type RecoveryCopyEvidence = AuthenticationRecoveryCopyEvidence

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

  private recoveryTexts(): RecoveryCopyTexts {
    if (typeof this.browser.document.querySelectorAll !== 'function') {
      return ((v) => (v ? v : ''))(this.browser.document.body?.innerText).split(
        /[\r\n]+/,
      )
    }
    const texts: RecoveryCopyTexts = []
    const elements = this.browser.document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], p, label, legend, button, li, code, pre',
    )
    for (const element of elements) {
      if (texts.length >= MAX_RECOVERY_COPY_ELEMENTS) break
      if (!this.isVisibleRecoveryCopy(element)) continue
      const text = ((v) => (v ? v : ''))(element.textContent)
      if (text.length > MAX_RECOVERY_SOURCE_TEXT_UNITS) continue
      texts.push(text)
    }
    return texts
  }

  async prepareAuthenticationRecoveryEvidence(): Promise<void> {
    const delivery = await sendCompanionWasmRuntimeMessage(this.browser, {
      type: CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence,
      payload: { texts: this.recoveryTexts() },
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
    }
  }

  private currentEvidence(): RecoveryCopyEvidence {
    if (typeof chrome === 'object' && Boolean(chrome.runtime?.id)) {
      return this.evidence
    }
    return authentication_recovery_copy_evidence({
      texts: this.recoveryTexts(),
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

  extractDocumentBackupCodeCandidates(sourceText?: string): string[] {
    const text = ((v) => (v ? v : ''))(
      ((...[v = this.browser.document.body?.innerText]) => v)(sourceText),
    )
    return extract_backup_code_candidates(text)
  }

  clearBackupCodeCandidates(codes: DocumentBackupCodeCandidates): void {
    for (let index = 0; index < codes.length; index += 1) {
      codes[index] = ''
    }
  }
}

export const recoveryCopyObservation = new RecoveryCopyObservation(globalThis)
