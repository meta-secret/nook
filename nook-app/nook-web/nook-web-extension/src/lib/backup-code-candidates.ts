import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  classify_authentication_backup_codes_observation,
  extract_backup_code_candidates,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Collect bounded instructional copy without reading code-list or input values. */
export function authenticationRecoveryCopy(): string {
  const copy = Array.from(
    document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], button, label, legend',
    ),
  )
    .flatMap((element) => [
      element.textContent ?? '',
      element.getAttribute('aria-label') ?? '',
      element.getAttribute('title') ?? '',
    ])
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
