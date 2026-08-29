import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  classify_authentication_backup_codes_observation,
  extract_backup_code_candidates,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { isRenderedControl } from '../../../nook-web-shared/src/extension/password-forms'

function isVisibleRecoveryCopy(element: HTMLElement): boolean {
  if (!isRenderedControl(element)) return false
  for (let current: HTMLElement | null = element; current;) {
    if (current.getAttribute('aria-hidden') === 'true') return false
    current = current.parentElement
  }
  return true
}

/** Collect bounded instructional copy without reading code-list or input values. */
export function authenticationRecoveryCopy(): string {
  const copy = Array.from(
    document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], p, label, legend',
    ),
  )
    .filter(isVisibleRecoveryCopy)
    .map((element) => element.textContent ?? '')
    .filter((text) => extract_backup_code_candidates(text).length === 0)
    .join(' ')
  return Array.from(copy).slice(0, 128).join('')
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
