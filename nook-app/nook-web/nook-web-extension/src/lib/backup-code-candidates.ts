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
type RecoveryCopyObservation = {
  text: string
  recoveryBearing: boolean
}

function boundedRecoveryCopy(texts: RecoveryCopyTexts): string {
  const visibleCopy: RecoveryCopyObservation[] = texts
    .filter((text) => !contains_backup_code_candidate(text))
    .map((text) => ({
      text,
      recoveryBearing:
        classify_authentication_backup_codes_observation(text) === 'present',
    }))
  const prioritizedCopy = [
    ...visibleCopy.filter(({ recoveryBearing }) => recoveryBearing),
    ...visibleCopy.filter(({ recoveryBearing }) => !recoveryBearing),
  ]
  let boundedCopy = ''
  for (const { text } of prioritizedCopy) {
    const separator = boundedCopy.length > 0 ? ' ' : ''
    const remaining =
      MAX_RECOVERY_COPY_CODE_POINTS - Array.from(boundedCopy + separator).length
    if (remaining <= 0) break
    boundedCopy += separator + Array.from(text).slice(0, remaining).join('')
  }
  return boundedCopy
}

/** Collect bounded instructional copy without reading code-list or input values. */
export function authenticationRecoveryCopy(): string {
  if (typeof document.querySelectorAll !== 'function') {
    return boundedRecoveryCopy(
      (document.body?.innerText ?? '').split(/[\r\n]+/),
    )
  }
  const texts: RecoveryCopyTexts = []
  const elements = document.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, [role="heading"], p, label, legend',
  )
  for (const element of elements) {
    if (texts.length >= MAX_RECOVERY_COPY_ELEMENTS) break
    if (!isVisibleRecoveryCopy(element)) continue
    const text = element.textContent ?? ''
    if (text.length > MAX_RECOVERY_SOURCE_TEXT_UNITS) continue
    texts.push(text)
  }
  return boundedRecoveryCopy(texts)
}

export function recoveryCopyHasBackupCodeHint(recoveryCopy: string): boolean {
  return (
    classify_authentication_backup_codes_observation(recoveryCopy) === 'present'
  )
}

export function pageHasDocumentBackupCodeHint(): boolean {
  return recoveryCopyHasBackupCodeHint(authenticationRecoveryCopy())
}

export function extractDocumentBackupCodeCandidates(
  sourceText?: string,
): string[] {
  const text = sourceText ?? document.body?.innerText ?? ''
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
