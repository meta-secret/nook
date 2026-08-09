import type { ExternalObject, ExternalValue } from './external-value'

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

export function decodePasskeySetupResponse(
  response: ExternalObject,
): PasskeySetupMaterial {
  const setup = responseObject(response.setup)
  return {
    userHandle: byteArray(setup.userHandle),
    prfInput: byteArray(setup.prfInput),
  }
}

export function decodePasskeyUnlockResponse(
  response: ExternalObject,
): PasskeyUnlockMaterial {
  const material = responseObject(response.material)
  return {
    credentialId: byteArray(material.credentialId),
    prfInput: byteArray(material.prfInput),
  }
}
