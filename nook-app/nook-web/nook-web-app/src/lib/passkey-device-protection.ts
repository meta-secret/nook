import {
  buildPasskeyRecoveryRequestOptions,
  buildPasskeyPrfRequestOptions,
  type NookVaultManager,
} from '$lib/nook-wasm/nook_wasm'

type PrfResults = {
  enabled?: boolean
  results?: { first?: ArrayBuffer }
}

type CredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: PrfResults
  }
}

type AssertionCredentialWithPrf = CredentialWithPrf & {
  response: AuthenticatorAssertionResponse
}

export class PasskeyPrfUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasskeyPrfUnavailableError'
  }
}

export function isPasskeyPrfUnavailableError(
  error: unknown,
): error is PasskeyPrfUnavailableError {
  return error instanceof PasskeyPrfUnavailableError
}

function requirePasskeySupport(): void {
  if (
    !window.isSecureContext ||
    typeof PublicKeyCredential === 'undefined' ||
    !navigator.credentials
  ) {
    throw new Error(
      'Passkeys require a supported browser in a secure context (HTTPS or localhost).',
    )
  }
}

function prfOutput(
  credential: CredentialWithPrf,
  requireEnabled = false,
): Uint8Array | undefined {
  const prf = credential.getClientExtensionResults().prf
  if (requireEnabled && prf?.enabled !== true) {
    throw new PasskeyPrfUnavailableError(
      'This authenticator does not support the WebAuthn PRF extension required to protect device keys.',
    )
  }
  const first = prf?.results?.first
  if (!first) return undefined
  const bytes = ArrayBuffer.isView(first)
    ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
    : new Uint8Array(first)
  return Uint8Array.from(bytes)
}

async function evaluatePrf(
  options: CredentialRequestOptions,
): Promise<Uint8Array> {
  const credential = await getPasskeyCredential(options)
  const output = prfOutput(credential)
  if (!output) {
    throw new PasskeyPrfUnavailableError(
      'The passkey did not return the required PRF output.',
    )
  }
  return output
}

async function getPasskeyCredential(
  options: CredentialRequestOptions,
): Promise<AssertionCredentialWithPrf> {
  const credential = (await navigator.credentials.get(options)) as
    | AssertionCredentialWithPrf
    | undefined

  if (!credential) throw new Error('Passkey authorization was cancelled.')
  return credential
}

/**
 * Create a discoverable passkey and let Rust/WASM wrap the device age key.
 * JavaScript handles only the browser platform call; option construction,
 * key derivation, and AES-GCM stay in Rust.
 */
export async function setupDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  requirePasskeySupport()
  const setup = await manager.beginDeviceProtection()
  const userHandle = new Uint8Array(setup.userHandle)
  const input = new Uint8Array(setup.prfInput)
  const creationOptions = setup.creationOptions(
    location.hostname,
    'Nook',
  ) as CredentialCreationOptions
  let output: Uint8Array | undefined = undefined
  try {
    const credential = (await navigator.credentials.create(creationOptions)) as
      | CredentialWithPrf
      | undefined

    if (!credential) throw new Error('Passkey creation was cancelled.')
    output = prfOutput(credential, true)
    const credentialId = new Uint8Array(credential.rawId)
    const requestOptions = buildPasskeyPrfRequestOptions(
      location.hostname,
      credentialId,
      input,
    ) as CredentialRequestOptions
    if (!output) output = await evaluatePrf(requestOptions)
    await manager.finishDeviceProtection(
      credentialId,
      userHandle,
      input,
      output,
    )
  } finally {
    output?.fill(0)
    input.fill(0)
    userHandle.fill(0)
    setup.free()
  }
}

/** Authorize the saved passkey and let Rust/WASM unwrap the device age key. */
export async function unlockDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  requirePasskeySupport()
  const options = await manager.passkeyUnlockOptions()
  const credentialId = new Uint8Array(options.credentialId)
  const input = new Uint8Array(options.prfInput)
  const requestOptions = options.requestOptions(
    location.hostname,
  ) as CredentialRequestOptions
  let output: Uint8Array | undefined = undefined
  try {
    output = await evaluatePrf(requestOptions)
    await manager.unlockDeviceIdentity(output)
  } finally {
    output?.fill(0)
    input.fill(0)
    credentialId.fill(0)
    options.free()
  }
}

/** Select an existing discoverable Nook passkey and rebuild this device root. */
export async function recoverDeviceProtectionWithPasskey(
  manager: NookVaultManager,
): Promise<void> {
  requirePasskeySupport()
  const requestOptions = buildPasskeyRecoveryRequestOptions(
    location.hostname,
  ) as CredentialRequestOptions
  let output: Uint8Array | undefined = undefined
  let userHandle: Uint8Array | undefined = undefined
  try {
    const credential = await getPasskeyCredential(requestOptions)
    output = prfOutput(credential)
    if (!output) {
      throw new PasskeyPrfUnavailableError(
        'The passkey did not return the required PRF output.',
      )
    }
    const rawUserHandle = credential.response.userHandle ?? undefined
    if (!rawUserHandle) {
      throw new Error('The selected passkey did not return a user handle.')
    }
    userHandle = new Uint8Array(rawUserHandle)
    const credentialId = new Uint8Array(credential.rawId)
    try {
      await manager.recoverDeviceProtectionWithPasskey(
        credentialId,
        userHandle,
        output,
      )
    } finally {
      credentialId.fill(0)
    }
  } finally {
    output?.fill(0)
    userHandle?.fill(0)
  }
}
