export type PasskeySetupMaterial = {
  userHandle: number[]
  prfInput: number[]
}

export type PasskeyUnlockMaterial = {
  credentialId: number[]
  prfInput: number[]
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class PasskeySetupResponse {
  private constructor() {}
  declare readonly setup: PasskeySetupMaterial
  static byteArray(value: PasskeyResponseByteSequence): number[] {
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

  static decodePasskeySetupResponse(
    response: PasskeySetupResponse,
  ): PasskeySetupMaterial {
    const setup = response.setup
    if (!setup) {
      throw new Error('Extension session returned a malformed setup response.')
    }
    return {
      userHandle: PasskeySetupResponse.byteArray(setup.userHandle),
      prfInput: PasskeySetupResponse.byteArray(setup.prfInput),
    }
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class PasskeyUnlockResponse {
  private constructor() {}
  declare readonly material: PasskeyUnlockMaterial
  static decodePasskeyUnlockResponse(
    response: PasskeyUnlockResponse,
  ): PasskeyUnlockMaterial {
    const material = response.material
    if (!material) {
      throw new Error('Extension session returned a malformed unlock response.')
    }
    return {
      credentialId: PasskeySetupResponse.byteArray(material.credentialId),
      prfInput: PasskeySetupResponse.byteArray(material.prfInput),
    }
  }
}

type PasskeyResponseByteSequence = number[]
