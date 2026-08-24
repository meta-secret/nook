import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initNookWasm, {
  configure_vault_application,
  VaultApplication,
} from '$app-wasm'

const wasmPath = join(
  process.cwd(),
  '../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
)
const companionWasmPath = join(
  process.cwd(),
  '../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
)
const originalFetch = globalThis.fetch?.bind(globalThis)

const nativeElementBounds = HTMLElement.prototype.getBoundingClientRect

function createDefaultElementBounds(): DOMRect {
  const bounds = nativeElementBounds.call(document.createElement('div'))
  Object.defineProperties(bounds, {
    bottom: { configurable: true, value: 32 },
    height: { configurable: true, value: 32 },
    left: { configurable: true, value: 0 },
    right: { configurable: true, value: 100 },
    top: { configurable: true, value: 0 },
    width: { configurable: true, value: 100 },
    x: { configurable: true, value: 0 },
    y: { configurable: true, value: 0 },
  })
  return bounds
}

HTMLElement.prototype.getBoundingClientRect = createDefaultElementBounds

Reflect.deleteProperty(WebAssembly, 'instantiateStreaming')

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString()
  if (url.endsWith('/nook-wasm/nook_wasm_bg.wasm')) {
    return new Response(readFileSync(wasmPath), {
      headers: { 'Content-Type': 'application/wasm' },
    })
  }
  if (url.includes('nook_companion_wasm_bg.wasm')) {
    return new Response(readFileSync(companionWasmPath), {
      headers: { 'Content-Type': 'application/wasm' },
    })
  }
  if (!originalFetch) {
    throw new Error(`No fetch implementation available for ${url}`)
  }
  return originalFetch(input, init)
}

await initNookWasm()
configure_vault_application(VaultApplication.UnifiedDevelopment)

const { companionWasmReady } =
  await import('../../../nook-web-shared/src/extension/companion-ready')
await companionWasmReady
