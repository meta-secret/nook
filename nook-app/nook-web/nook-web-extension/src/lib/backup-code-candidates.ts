import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  classify_authentication_backup_codes_observation,
  contains_backup_code_candidate,
  extract_backup_code_candidates,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { isRenderedControl } from '../../../nook-web-shared/src/extension/password-form-submission-controls'

function isVisibleRecoveryCopy(element: HTMLElement): boolean {
  if (!isRenderedControl(element)) return false
  for (let current: HTMLElement | null = element; current;) {
    if (current.getAttribute('aria-hidden') === 'true') return false
    current = current.parentElement
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
    const remaining = 128 - Array.from(boundedCopy + separator).length
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
  const texts = Array.from(
    document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], p, label, legend',
    ),
  )
    .filter(isVisibleRecoveryCopy)
    .map((element) => element.textContent ?? '')
  return boundedRecoveryCopy(texts)
}

export function pageHasDocumentBackupCodeHint(): boolean {
  return (
    classify_authentication_backup_codes_observation(
      authenticationRecoveryCopy(),
    ) === 'present'
  )
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
