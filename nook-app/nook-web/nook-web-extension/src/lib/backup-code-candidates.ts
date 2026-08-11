import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

void companionWasmReady
import {
  extract_backup_code_candidates,
  page_has_backup_code_hint,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export function pageHasBackupCodeHint(): boolean {
  const bodyText = document.body?.innerText ?? ''
  return page_has_backup_code_hint(bodyText)
}

export function extractBackupCodeCandidates(sourceText?: string): string[] {
  const text = sourceText ?? document.body?.innerText ?? ''
  return extract_backup_code_candidates(text)
}

export function clearBackupCodeCandidates(codes: string[]): void {
  for (let index = 0; index < codes.length; index += 1) {
    codes[index] = ''
  }
}
