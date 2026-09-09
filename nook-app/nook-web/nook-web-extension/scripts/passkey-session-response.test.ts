import initNookWasm, {
  decode_passkey_setup_material_response,
  decode_passkey_unlock_material_response,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type PasskeySetupMaterial,
  type PasskeySetupResponse,
  type PasskeyUnlockResponse,
} from '../src/lib/passkey-session-response'

beforeAll(async () => {
  await initNookWasm({
    module_or_path: await Bun.file(
      new URL(
        '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
        import.meta.url,
      ),
    ).arrayBuffer(),
  })
})

const fixedByteArrayArgs: { length: number } = { length: 32 }
const fixedBytes = Array.from(fixedByteArrayArgs, () => 7)

describe('passkey session response decoding', () => {
  test('accepts fixed-size setup key material', () => {
    const response: PasskeySetupResponse = {
      setup: { userHandle: fixedBytes, prfInput: fixedBytes },
    }

    const expected: PasskeySetupMaterial = {
      userHandle: fixedBytes,
      prfInput: fixedBytes,
    }
    expect(decode_passkey_setup_material_response(response)).toEqual(expected)
  })

  test('leaves setup key-material policy to the Rust option builder', () => {
    const emptyResponse: PasskeySetupResponse = {
      setup: { userHandle: [], prfInput: fixedBytes },
    }
    const shortResponse: PasskeySetupResponse = {
      setup: { userHandle: fixedBytes, prfInput: [1] },
    }

    expect(
      decode_passkey_setup_material_response(emptyResponse).userHandle,
    ).toEqual([])
    expect(
      decode_passkey_setup_material_response(shortResponse).prfInput,
    ).toEqual([1])
  })

  test('leaves unlock material policy to the Rust option builder', () => {
    const emptyCredential: PasskeyUnlockResponse = {
      material: { credentialId: [], prfInput: fixedBytes },
    }
    const shortPrfInput: PasskeyUnlockResponse = {
      material: { credentialId: [1], prfInput: [2] },
    }

    expect(
      decode_passkey_unlock_material_response(emptyCredential).credentialId,
    ).toEqual([])
    expect(
      decode_passkey_unlock_material_response(shortPrfInput).prfInput,
    ).toEqual([2])
  })
})
