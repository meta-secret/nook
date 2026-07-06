import type { NookVaultManager } from '$lib/nook-wasm/nook_wasm'

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

function randomChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
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
  credentialId: Uint8Array,
  input: Uint8Array,
): Promise<Uint8Array> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      rpId: location.hostname,
      allowCredentials: [
        {
          type: 'public-key',
          id: credentialId,
        },
      ],
      userVerification: 'required',
      extensions: {
        prf: {
          evalByCredential: {
            [base64Url(credentialId)]: { first: input },
          },
        },
      },
    },
  } as CredentialRequestOptions)) as CredentialWithPrf | undefined

  if (!credential) throw new Error('Passkey authorization was cancelled.')
  const output = prfOutput(credential)
  if (!output) {
    throw new Error('The passkey did not return the required PRF output.')
  }
  return output
}

/**
 * Create a discoverable passkey and let Rust/WASM wrap the device age key.
 * JavaScript handles only WebAuthn; key derivation and AES-GCM stay in Rust.
 */
export async function setupDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  requirePasskeySupport()
  const setup = await manager.beginDeviceProtection()
  const userHandle = new Uint8Array(setup.userHandle)
  const input = new Uint8Array(setup.prfInput)
  let output: Uint8Array | undefined = undefined
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { id: location.hostname, name: 'Nook' },
        user: {
          id: userHandle,
          name: 'Nook device',
          displayName: 'Nook device',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        attestation: 'none',
        extensions: {
          prf: { eval: { first: input } },
        },
      },
    } as CredentialCreationOptions)) as CredentialWithPrf | undefined

    if (!credential) throw new Error('Passkey creation was cancelled.')
    output = prfOutput(credential, true)
    const credentialId = new Uint8Array(credential.rawId)
    if (!output) output = await evaluatePrf(credentialId, input)
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
  let output: Uint8Array | undefined = undefined
  try {
    output = await evaluatePrf(credentialId, input)
    await manager.unlockDeviceIdentity(output)
  } finally {
    output?.fill(0)
    input.fill(0)
    credentialId.fill(0)
    options.free()
  }
}
