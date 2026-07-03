import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const wasmPath = join(process.cwd(), 'src/lib/nook-wasm/nook_wasm_bg.wasm')
const originalFetch = globalThis.fetch?.bind(globalThis)

Object.defineProperty(WebAssembly, 'instantiateStreaming', {
  configurable: true,
  value: undefined,
})

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString()
  if (url.endsWith('/src/lib/nook-wasm/nook_wasm_bg.wasm')) {
    return new Response(readFileSync(wasmPath), {
      headers: { 'Content-Type': 'application/wasm' },
    })
  }
  if (!originalFetch) {
    throw new Error(`No fetch implementation available for ${url}`)
  }
  return originalFetch(input, init)
}
