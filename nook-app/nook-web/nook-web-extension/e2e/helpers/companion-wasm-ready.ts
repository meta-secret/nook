import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configuredCompanionWasmPath =
  process.env.NOOK_EXTENSION_E2E_WASM_PATH?.trim() ?? ''
const companionWasmPath =
  configuredCompanionWasmPath.length > 0
    ? configuredCompanionWasmPath
    : path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
      )

const nativeFetch = globalThis.fetch
const wasmFetch = new Proxy(nativeFetch, {
  apply: (
    target: typeof fetch,
    thisArgument: unknown,
    argumentsList: Parameters<typeof fetch>,
  ) => {
    const input = argumentsList[0]
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (!url.endsWith('nook_companion_wasm_bg.wasm')) {
      return Reflect.apply(target, thisArgument, argumentsList)
    }
    return Promise.resolve(
      new Response(readFileSync(companionWasmPath), {
        headers: { 'Content-Type': 'application/wasm' },
      }),
    )
  },
})
globalThis.fetch = wasmFetch

const { companionWasmReady } =
  await import('../../../nook-web-shared/src/extension/companion-ready')

export { companionWasmReady }
