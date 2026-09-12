import type {
  PasskeySetupMaterial,
  PasskeyUnlockMaterial,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export type { PasskeySetupMaterial, PasskeyUnlockMaterial }
/** Browser response envelopes contain canonical Rust-owned material. */
export type PasskeySetupResponse = { setup: PasskeySetupMaterial }
export type PasskeyUnlockResponse = { material: PasskeyUnlockMaterial }
