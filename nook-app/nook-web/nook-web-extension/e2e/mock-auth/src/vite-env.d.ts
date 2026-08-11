/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module 'nook-wasm' {
  export default function init(
    module_or_path?:
      RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
  ): Promise<unknown>
  export function generate_totp_code(
    secret: string,
    unixSeconds: bigint,
  ): string
  export function verify_totp_code(
    secret: string,
    code: string,
    unixSeconds: bigint,
  ): boolean
}
