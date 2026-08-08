import { describe, expect, test } from 'bun:test'
import type { ExternalObject } from '../src/lib/external-value'
import {
  decodePasskeySetupResponse,
  decodePasskeyUnlockResponse,
  type PasskeySetupMaterial,
} from '../src/lib/passkey-session-response'

const fixedByteArrayArgs: { length: number } = { length: 32 }
const fixedBytes = Array.from(fixedByteArrayArgs, () => 7)

describe('passkey session response decoding', () => {
  test('accepts fixed-size setup key material', () => {
    const response: ExternalObject = {
      setup: { userHandle: fixedBytes, prfInput: fixedBytes },
    }

    const expected: PasskeySetupMaterial = {
      userHandle: fixedBytes,
      prfInput: fixedBytes,
    }
    expect(decodePasskeySetupResponse(response)).toEqual(expected)
  })

  test('rejects empty and wrong-sized setup key material', () => {
    const emptyResponse: ExternalObject = {
      setup: { userHandle: [], prfInput: fixedBytes },
    }
    const shortResponse: ExternalObject = {
      setup: { userHandle: fixedBytes, prfInput: [1] },
    }

    expect(() => decodePasskeySetupResponse(emptyResponse)).toThrow(
      'malformed passkey byte material',
    )
    expect(() => decodePasskeySetupResponse(shortResponse)).toThrow(
      'malformed passkey byte material',
    )
  })

  test('requires a nonempty credential ID and fixed-size unlock PRF input', () => {
    const emptyCredential: ExternalObject = {
      material: { credentialId: [], prfInput: fixedBytes },
    }
    const shortPrfInput: ExternalObject = {
      material: { credentialId: [1], prfInput: [2] },
    }

    expect(() => decodePasskeyUnlockResponse(emptyCredential)).toThrow(
      'malformed passkey credential ID',
    )
    expect(() => decodePasskeyUnlockResponse(shortPrfInput)).toThrow(
      'malformed passkey byte material',
    )
  })
})
