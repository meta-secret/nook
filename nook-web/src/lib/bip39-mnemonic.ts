let wasmModule: typeof import('./nook-wasm/nook_wasm.js') | null = null

async function loadWasm() {
  if (!wasmModule) {
    wasmModule = await import('./nook-wasm/nook_wasm.js')
  }
  return wasmModule
}

export async function validateBip39MnemonicChecksum(
  mnemonic: string,
): Promise<boolean> {
  const wasm = await loadWasm()
  return wasm.validateBip39Mnemonic(mnemonic)
}
