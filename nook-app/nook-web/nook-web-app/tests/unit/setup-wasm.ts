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
Reflect.deleteProperty(WebAssembly, 'instantiateStreaming')

const wasmFetch = new Proxy(globalThis.fetch, {
  apply: async (
    target,
    thisArgument,
    [input, init]: [RequestInfo | URL, RequestInit?],
  ) => {
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
    return Reflect.apply(target, thisArgument, [input, init])
  },
})
globalThis.fetch = wasmFetch

await initNookWasm()
configure_vault_application(VaultApplication.UnifiedDevelopment)

const { companionWasmReady } =
  await import('../../../nook-web-shared/src/extension/companion-ready')
await companionWasmReady
