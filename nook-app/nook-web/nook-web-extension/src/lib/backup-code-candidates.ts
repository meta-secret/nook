import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  extract_backup_code_candidates,
  page_has_backup_code_hint,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export function pageHasDocumentBackupCodeHint(): boolean {
  const bodyText = document.body?.innerText ?? ''
  return (
    textHasBackupCodeHint(bodyText) &&
    extractDocumentBackupCodeCandidates(bodyText).length > 0
  )
}

export function textHasBackupCodeHint(sourceText: string): boolean {
  return page_has_backup_code_hint(sourceText)
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
