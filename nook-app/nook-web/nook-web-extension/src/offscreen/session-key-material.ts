import {
  admit_passkey_byte_material,
  type PasskeyByteMaterial,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

/** Browser representation conversion follows canonical Rust octet admission. */
export class PasskeyBrowserBytes {
  static fromWire(value: PasskeyByteMaterial): Uint8Array {
    return new Uint8Array(admit_passkey_byte_material(value))
  }
  static toWire(value: Uint8Array): PasskeyByteMaterial {
    return Array.from(value)
  }
}
