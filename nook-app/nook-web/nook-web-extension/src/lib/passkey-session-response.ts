export type PasskeySetupMaterial = {
  userHandle: number[]
  prfInput: number[]
}

export type PasskeyUnlockMaterial = {
  credentialId: number[]
  prfInput: number[]
}

export type PasskeySetupResponse = {
  setup?: Partial<PasskeySetupMaterial>
}

export type PasskeyUnlockResponse = {
  material?: Partial<PasskeyUnlockMaterial>
}

function byteArray(value: number[] | undefined): number[] {
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
  response: PasskeySetupResponse,
): PasskeySetupMaterial {
  const setup = response.setup
  if (!setup) {
    throw new Error('Extension session returned a malformed setup response.')
  }
  return {
    userHandle: byteArray(setup.userHandle),
    prfInput: byteArray(setup.prfInput),
  }
}

export function decodePasskeyUnlockResponse(
  response: PasskeyUnlockResponse,
): PasskeyUnlockMaterial {
  const material = response.material
  if (!material) {
    throw new Error('Extension session returned a malformed unlock response.')
  }
  return {
    credentialId: byteArray(material.credentialId),
    prfInput: byteArray(material.prfInput),
  }
}
