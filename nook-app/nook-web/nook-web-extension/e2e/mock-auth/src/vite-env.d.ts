/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module 'nook-wasm' {
  export default function init(
    module_or_path?:
      | RequestInfo
      | URL
      | Response
      | BufferSource
      | WebAssembly.Module,
  ): Promise<unknown>
  export function generateTotpCode(secret: string, unixSeconds: bigint): string
  export function verifyTotpCode(
    secret: string,
    code: string,
    unixSeconds: bigint,
  ): boolean
}
