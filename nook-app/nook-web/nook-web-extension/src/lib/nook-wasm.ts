import {
  defaultPasswordGenerationOptions,
  generatePasswordWithOptions,
  type PasswordGenerationOptions,
} from '../../../nook-web-shared/src/password/generator'
import {
  default as initNookWasm,
  generatePassword as wasmGeneratePassword,
} from '../../../nook-web-app/src/lib/nook-wasm/nook_wasm'

let initPromise: Promise<unknown> | undefined

function ensureNookWasm() {
  initPromise ??= initNookWasm()
  return initPromise
}

export async function generateSuggestedPassword(
  options: PasswordGenerationOptions = defaultPasswordGenerationOptions,
): Promise<string> {
  await ensureNookWasm()
  return generatePasswordWithOptions(wasmGeneratePassword, options)
}
