import {
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
    throw new Error(
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
  const credential = (await navigator.credentials.get(options)) as
    | CredentialWithPrf
    | undefined

  if (!credential) throw new Error('Passkey authorization was cancelled.')
  const output = prfOutput(credential)
  if (!output) {
    throw new Error('The passkey did not return the required PRF output.')
  }
  return output
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
