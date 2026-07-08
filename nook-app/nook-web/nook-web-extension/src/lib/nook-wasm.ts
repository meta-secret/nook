import {
  defaultPasswordGenerationOptions,
  generatePasswordWithOptions,
  type PasswordGenerationOptions,
} from '../../../nook-web-shared/src/password/generator'
import {
  default as initNookWasm,
  buildPasskeyPrfRequestOptions,
  generatePassword as wasmGeneratePassword,
  get_translation_catalog as wasmGetTranslationCatalog,
  NookVaultManager,
  parseAppLocale as wasmParseAppLocale,
  resolveAppLocaleFromTags as wasmResolveAppLocaleFromTags,
  resolveTranslationCatalog as wasmResolveTranslationCatalog,
  translateFromCatalog as wasmTranslateFromCatalog,
  type NookAppLocale,
} from '../../../nook-web-app/src/lib/nook-wasm/nook_wasm'

let initPromise: Promise<unknown> | undefined

type PrfResults = {
  enabled?: boolean
  results?: { first?: ArrayBuffer }
}

type CredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: PrfResults
  }
}

export type { NookAppLocale }

export function ensureNookWasm() {
  initPromise ??= initNookWasm()
  return initPromise
}

function requirePasskeySupport(): void {
  if (
    !window.isSecureContext ||
    typeof PublicKeyCredential === 'undefined' ||
    !navigator.credentials
  ) {
    throw new Error('Passkeys require a supported browser in a secure context.')
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

export type ExtensionDeviceProtectionResult = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

export async function setupExtensionDeviceProtection(): Promise<ExtensionDeviceProtectionResult> {
  requirePasskeySupport()
  await ensureNookWasm()

  const manager = new NookVaultManager()
  const setup = await manager.beginDeviceProtection()
  const userHandle = new Uint8Array(setup.userHandle)
  const input = new Uint8Array(setup.prfInput)
  const creationOptions = setup.creationOptions(
    location.hostname,
    'Nook Extension',
  ) as CredentialCreationOptions
  let output: Uint8Array | undefined = undefined
  let credentialId: Uint8Array | undefined = undefined

  try {
    const credential = (await navigator.credentials.create(creationOptions)) as
      | CredentialWithPrf
      | undefined

    if (!credential) throw new Error('Passkey creation was cancelled.')
    output = prfOutput(credential, true)
    credentialId = new Uint8Array(credential.rawId)
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

    return {
      deviceId: manager.device_id,
      devicePublicKey: manager.device_public_key,
      deviceSigningPublicKey: await manager.deviceSigningPublicKey(),
    }
  } finally {
    output?.fill(0)
    credentialId?.fill(0)
    input.fill(0)
    userHandle.fill(0)
    setup.free()
    manager.free()
  }
}

export async function generateSuggestedPassword(
  options: PasswordGenerationOptions = defaultPasswordGenerationOptions,
): Promise<string> {
  await ensureNookWasm()
  return generatePasswordWithOptions(wasmGeneratePassword, options)
}

export async function parseStoredAppLocale(
  value: string | undefined,
): Promise<NookAppLocale | undefined> {
  await ensureNookWasm()
  return wasmParseAppLocale(value) as NookAppLocale | undefined
}

export async function resolveAppLocaleFromTags(
  tags: string[],
): Promise<NookAppLocale> {
  await ensureNookWasm()
  return wasmResolveAppLocaleFromTags(tags) as NookAppLocale
}

export async function getResolvedTranslationCatalog(
  locale: NookAppLocale,
): Promise<string> {
  await ensureNookWasm()
  let wasmCatalog: string | undefined
  try {
    wasmCatalog = wasmGetTranslationCatalog(locale)
  } catch {
    wasmCatalog = undefined
  }
  return wasmResolveTranslationCatalog(locale, wasmCatalog)
}

export function translateFromExtensionCatalog(
  catalog: string,
  locale: NookAppLocale,
  key: string,
): string {
  return wasmTranslateFromCatalog(catalog, locale, key)
}
