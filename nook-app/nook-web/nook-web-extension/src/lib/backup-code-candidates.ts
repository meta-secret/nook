import '../../../nook-web-shared/src/extension/companion-ready'
import {
  extractBackupCodeCandidates as wasmExtractBackupCodeCandidates,
  pageHasBackupCodeHint as wasmPageHasBackupCodeHint,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export function pageHasBackupCodeHint(): boolean {
  const bodyText = document.body?.innerText ?? ''
  return wasmPageHasBackupCodeHint(bodyText)
}

export function extractBackupCodeCandidates(sourceText?: string): string[] {
  const text = sourceText ?? document.body?.innerText ?? ''
  return wasmExtractBackupCodeCandidates(text)
}

export function clearBackupCodeCandidates(codes: string[]): void {
  for (let index = 0; index < codes.length; index += 1) {
    codes[index] = ''
  }
}
