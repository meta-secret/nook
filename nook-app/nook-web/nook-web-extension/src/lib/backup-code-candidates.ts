import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady

import {
  classify_authentication_backup_codes_observation,
  authentication_recovery_copy_evidence,
  extract_backup_code_candidates,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import { authenticationSubmissionControls } from '../../../nook-web-shared/src/extension/password-form-submission-controls'

const MAX_RECOVERY_SOURCE_TEXT_UNITS = 256

const MAX_RECOVERY_COPY_ELEMENTS = 128

type RecoveryCopyTexts = string[]

type RecoveryCopyEvidence = ReturnType<
  typeof authentication_recovery_copy_evidence
>

export type DocumentBackupCodeCandidates = string[]

/** Owns this browser host’s resources and interaction lifecycle. */
class RecoveryCopyObservation {
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

  authenticationRecoveryEvidence(): RecoveryCopyEvidence {
    if (typeof this.browser.document.querySelectorAll !== 'function') {
      return authentication_recovery_copy_evidence({
        texts: ((v) => (v ? v : ''))(
          this.browser.document.body?.innerText,
        ).split(/[\r\n]+/),
      })
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
    return authentication_recovery_copy_evidence({ texts })
  }

  authenticationRecoveryCopy(): string {
    return this.authenticationRecoveryEvidence().copy
  }

  recoveryCopyHasBackupCodeHint(recoveryCopy: string): boolean {
    return (
      classify_authentication_backup_codes_observation(recoveryCopy, false) ===
      'present'
    )
  }

  pageHasDocumentBackupCodeHint(): boolean {
    return this.authenticationRecoveryEvidence().hint === 'present'
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
