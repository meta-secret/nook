import type { ExternalObject, ExternalValue } from './external-value'

const PASSKEY_KEY_MATERIAL_LENGTH = 32
const PASSKEY_CREDENTIAL_ID_MAX_LENGTH = 1024

export type PasskeySetupMaterial = {
  userHandle: number[]
  prfInput: number[]
}

export type PasskeyUnlockMaterial = {
  credentialId: number[]
  prfInput: number[]
}

function isResponseObject(value: ExternalValue): value is ExternalObject {
  return typeof value === 'object' && !Array.isArray(value)
}

function responseObject(value: ExternalValue): ExternalObject {
  if (!isResponseObject(value)) {
    throw new Error('Extension session returned a malformed response.')
  }
  return value
}

function byteArray(value: ExternalValue): number[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        typeof item === 'number' &&
        Number.isInteger(item) &&
        item >= 0 &&
        item <= 255,
    )
  ) {
    throw new Error('Extension session returned malformed byte material.')
  }
  return [...value]
}

function fixedPasskeyByteArray(value: ExternalValue): number[] {
  const decoded = byteArray(value)
  if (decoded.length !== PASSKEY_KEY_MATERIAL_LENGTH) {
    throw new Error(
      'Extension session returned malformed passkey byte material.',
    )
  }
  return decoded
}

function passkeyCredentialId(value: ExternalValue): number[] {
  const decoded = byteArray(value)
  if (
    decoded.length === 0 ||
    decoded.length > PASSKEY_CREDENTIAL_ID_MAX_LENGTH
  ) {
    throw new Error(
      'Extension session returned malformed passkey credential ID.',
    )
  }
  return decoded
}

export function decodePasskeySetupResponse(
  response: ExternalObject,
): PasskeySetupMaterial {
  const setup = responseObject(response.setup)
  return {
    userHandle: fixedPasskeyByteArray(setup.userHandle),
    prfInput: fixedPasskeyByteArray(setup.prfInput),
  }
}

export function decodePasskeyUnlockResponse(
  response: ExternalObject,
): PasskeyUnlockMaterial {
  const material = responseObject(response.material)
  return {
    credentialId: passkeyCredentialId(material.credentialId),
    prfInput: fixedPasskeyByteArray(material.prfInput),
  }
}
