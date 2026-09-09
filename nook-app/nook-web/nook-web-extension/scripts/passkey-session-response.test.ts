import { describe, expect, test } from 'bun:test'
import {
  type PasskeySetupMaterial,
  type PasskeySetupResponse,
  type PasskeyUnlockResponse,
  PasskeySetupResponse as PasskeySetupResponseSchema,
  PasskeyUnlockResponse as PasskeyUnlockResponseSchema,
} from '../src/lib/passkey-session-response'

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
    expect(
      PasskeySetupResponseSchema.decodePasskeySetupResponse(response),
    ).toEqual(expected)
  })

  test('leaves setup key-material policy to the Rust option builder', () => {
    const emptyResponse: PasskeySetupResponse = {
      setup: { userHandle: [], prfInput: fixedBytes },
    }
    const shortResponse: PasskeySetupResponse = {
      setup: { userHandle: fixedBytes, prfInput: [1] },
    }

    expect(
      PasskeySetupResponseSchema.decodePasskeySetupResponse(emptyResponse)
        .userHandle,
    ).toEqual([])
    expect(
      PasskeySetupResponseSchema.decodePasskeySetupResponse(shortResponse)
        .prfInput,
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
      PasskeyUnlockResponseSchema.decodePasskeyUnlockResponse(emptyCredential)
        .credentialId,
    ).toEqual([])
    expect(
      PasskeyUnlockResponseSchema.decodePasskeyUnlockResponse(shortPrfInput)
        .prfInput,
    ).toEqual([2])
  })
})
