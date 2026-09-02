import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  classify_authentication_backup_codes_observation,
  contains_backup_code_candidate,
  extract_backup_code_candidates,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { isRenderedControl } from '../../../nook-web-shared/src/extension/password-form-submission-controls'

const MAX_RECOVERY_COPY_CODE_POINTS = 128
const MAX_RECOVERY_SOURCE_TEXT_UNITS = 256
const MAX_RECOVERY_COPY_ELEMENTS = 128

function isVisibleRecoveryCopy(element: HTMLElement): boolean {
  if (!isRenderedControl(element)) return false
  let current = element
  while (true) {
    if (current.getAttribute('aria-hidden') === 'true') return false
    const parent = current.parentElement
    if (!parent) break
    current = parent
  }
  return true
}

type RecoveryCopyTexts = string[]
type RecoveryCopyEvidence = readonly [copy: string, hint: boolean]
function boundedRecoveryCopy(texts: RecoveryCopyTexts): RecoveryCopyEvidence {
  const candidatePresent = texts.some(contains_backup_code_candidate)
  const safeTexts = texts.filter(
    (text) => !contains_backup_code_candidate(text),
  )
  const recoveryCopy = safeTexts.filter(
    (text) =>
      classify_authentication_backup_codes_observation(text, false) ===
      'present',
  )
  if (candidatePresent) {
    recoveryCopy.push(
      ...safeTexts.filter(
        (text) =>
          !recoveryCopy.includes(text) &&
          classify_authentication_backup_codes_observation(text, true) ===
            'present',
      ),
    )
  }
  let boundedCopy = ''
  for (const text of recoveryCopy) {
    const separator = boundedCopy.length > 0 ? ' ' : ''
    const remaining =
      MAX_RECOVERY_COPY_CODE_POINTS - Array.from(boundedCopy + separator).length
    if (remaining <= 0) break
    boundedCopy += separator + Array.from(text).slice(0, remaining).join('')
  }
  return [boundedCopy, recoveryCopy.length > 0]
}

/** Collect bounded instructional copy without reading code-list or input values. */
export function authenticationRecoveryEvidence(): RecoveryCopyEvidence {
  if (typeof document.querySelectorAll !== 'function') {
    return boundedRecoveryCopy(
      ((v) => (v ? v : ''))(document.body?.innerText).split(/[\r\n]+/),
    )
  }
  const texts: RecoveryCopyTexts = []
  const elements = document.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, [role="heading"], p, label, legend, button, li, code, pre',
  )
  for (const element of elements) {
    if (texts.length >= MAX_RECOVERY_COPY_ELEMENTS) break
    if (!isVisibleRecoveryCopy(element)) continue
    const text = ((v) => (v ? v : ''))(element.textContent)
    if (text.length > MAX_RECOVERY_SOURCE_TEXT_UNITS) continue
    texts.push(text)
  }
  return boundedRecoveryCopy(texts)
}

export function authenticationRecoveryCopy(): string {
  return authenticationRecoveryEvidence()[0]
}

export function recoveryCopyHasBackupCodeHint(recoveryCopy: string): boolean {
  return (
    classify_authentication_backup_codes_observation(recoveryCopy, false) ===
    'present'
  )
}

export function pageHasDocumentBackupCodeHint(): boolean {
  return authenticationRecoveryEvidence()[1]
}

export function extractDocumentBackupCodeCandidates(
  sourceText?: string,
): string[] {
  const text = ((v) => (v ? v : ''))(
    ((...[v = document.body?.innerText]) => v)(sourceText),
  )
  return extract_backup_code_candidates(text)
}

export type DocumentBackupCodeCandidates = string[]

export function clearBackupCodeCandidates(
  codes: DocumentBackupCodeCandidates,
): void {
  for (let index = 0; index < codes.length; index += 1) {
    codes[index] = ''
  }
}
