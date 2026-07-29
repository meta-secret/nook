import {
  defaultPasswordGenerationOptions,
  generatePasswordWithOptions,
  type PasswordGenerationOptions,
} from '../../../nook-web-shared/src/password/generator'
import { intoWasmStringValue } from '../../../nook-web-shared/src/vault-app/lib/wasm-string-value'
import {
  default as initNookWasm,
  buildPasskeyCreationOptions,
  buildPasskeyPrfRequestOptions,
  buildPasskeyRecoveryRequestOptions,
  configureVaultApplication,
  defaultTranslationCatalog as wasmDefaultTranslationCatalog,
  DeviceMode,
  DeviceProtectionStatus,
  generatePassword as wasmGeneratePassword,
  get_translation_catalog as wasmGetTranslationCatalog,
  parseAppLocale as wasmParseAppLocale,
  NookStringValue,
  NookValueState,
  resolveAppLocaleFromTags as wasmResolveAppLocaleFromTags,
  resolveTranslationCatalog as wasmResolveTranslationCatalog,
  VaultApplication,
  type NookAppLocale,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

enum ExtensionWasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type ExtensionWasmStartup =
  | { kind: ExtensionWasmStartupKind.NotStarted }
  | { kind: ExtensionWasmStartupKind.Initializing; operation: Promise<unknown> }

let extensionWasmStartup: ExtensionWasmStartup = {
  kind: ExtensionWasmStartupKind.NotStarted,
}

export type { NookAppLocale } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
export { DeviceMode, DeviceProtectionStatus }

export enum StoredAppLocaleInputKind {
  Missing = 'missing',
  Stored = 'stored',
}

export type StoredAppLocaleInput =
  | { kind: StoredAppLocaleInputKind.Missing }
  | { kind: StoredAppLocaleInputKind.Stored; value: string }

export enum StoredAppLocaleParseKind {
  Unsupported = 'unsupported',
  Supported = 'supported',
}

export type StoredAppLocaleParse =
  | { kind: StoredAppLocaleParseKind.Unsupported }
  | { kind: StoredAppLocaleParseKind.Supported; locale: NookAppLocale }

export function ensureNookWasm() {
  if (extensionWasmStartup.kind === ExtensionWasmStartupKind.Initializing) {
    return extensionWasmStartup.operation
  }
  const operation = initNookWasm().then((value) => {
    configureVaultApplication(VaultApplication.Extension)
    return value
  })
  extensionWasmStartup = {
    kind: ExtensionWasmStartupKind.Initializing,
    operation,
  }
  return operation
}

export type ExtensionDeviceProtectionResult = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type SessionResponse<T> = { ok: true } & T

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
  }
}

function runtimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError?.message) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response) {
        reject(new Error('Extension session did not respond.'))
        return
      }
      resolve(response as T)
    })
  })
}

async function sessionMessage<T>(message: unknown): Promise<T> {
  const runtime = await runtimeMessage<{ ok?: boolean; reason?: string }>({
    type: 'nook:ensure-extension-session-runtime',
  })
  if (runtime.ok !== true) {
    throw new Error(
      runtime.reason ?? 'Extension session runtime could not start.',
    )
  }
  const response = await runtimeMessage<{ ok?: boolean; error?: string } & T>(
    message,
  )
  if (response.ok !== true) {
    throw new Error(response.error ?? 'Extension session operation failed.')
  }
  return response
}

function bytes(value: ArrayBuffer | ArrayBufferView): number[] {
  return Array.from(
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  )
}

function credentialId(credential: PublicKeyCredential): number[] {
  return bytes(credential.rawId)
}

function assertionUserHandle(credential: PublicKeyCredential): number[] {
  const response = credential.response as AuthenticatorAssertionResponse
  if (!response.userHandle) {
    throw new Error('Passkey assertion did not include its user handle.')
  }
  return bytes(response.userHandle)
}

function prfOutput(credential: PublicKeyCredential): number[] {
  const prf = (
    credential as PublicKeyCredentialWithPrf
  ).getClientExtensionResults().prf
  // `enabled` reports registration support; assertion results are authoritative
  // when the browser returns the requested PRF output.
  if (!prf?.results?.first) {
    throw new Error(
      'PASSKEY_PRF_UNAVAILABLE: The passkey did not return the required PRF output.',
    )
  }
  return bytes(prf.results.first)
}

enum PasskeyOperation {
  Create = 'create',
  Get = 'get',
}

function passkeyError(error: unknown, action: PasskeyOperation): Error {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error(
      `PASSKEY_CEREMONY_NOT_ALLOWED: Passkey ${action} request did not finish.`,
    )
  }
  return error instanceof Error
    ? error
    : new Error(`Passkey ${action} ceremony failed.`)
}

async function getPasskey(
  options: unknown,
): Promise<PublicKeyCredentialWithPrf> {
  if (
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    throw new Error(
      'PASSKEY_UNAVAILABLE: Passkeys are not available in this browser.',
    )
  }
  try {
    const credential = await navigator.credentials.get(
      options as CredentialRequestOptions,
    )
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Passkey get ceremony was cancelled.')
    }
    return credential as PublicKeyCredentialWithPrf
  } catch (error) {
    throw passkeyError(error, PasskeyOperation.Get)
  }
}

async function createPasskey(
  options: unknown,
): Promise<PublicKeyCredentialWithPrf> {
  if (
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    throw new Error(
      'PASSKEY_UNAVAILABLE: Passkeys are not available in this browser.',
    )
  }
  try {
    const credential = await navigator.credentials.create(
      options as CredentialCreationOptions,
    )
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Passkey create ceremony was cancelled.')
    }
    return credential as PublicKeyCredentialWithPrf
  } catch (error) {
    throw passkeyError(error, PasskeyOperation.Create)
  }
}

export async function extensionDeviceProtectionStatus(): Promise<DeviceProtectionStatus> {
  const { status } = await sessionMessage<
    SessionResponse<{ status: DeviceProtectionStatus }>
  >({ type: 'nook:extension-session-status' })
  switch (status) {
    case DeviceProtectionStatus.Missing:
    case DeviceProtectionStatus.Plaintext:
    case DeviceProtectionStatus.Passkey:
    case DeviceProtectionStatus.Pin:
    case DeviceProtectionStatus.Unlocked:
      return status
    default:
      throw new Error(
        `Unsupported extension device protection status: ${status}`,
      )
  }
}

export enum ExtensionSessionDeviceStateKind {
  Locked = 'locked',
  Active = 'active',
}

export type ExtensionSessionDeviceState =
  | { kind: ExtensionSessionDeviceStateKind.Locked }
  | {
      kind: ExtensionSessionDeviceStateKind.Active
      device: ExtensionDeviceProtectionResult
    }

export async function extensionSessionDevice(): Promise<ExtensionSessionDeviceState> {
  const response = await sessionMessage<
    SessionResponse<{
      status: DeviceProtectionStatus
      device?: ExtensionDeviceProtectionResult
    }>
  >({ type: 'nook:extension-session-status' })
  return response.status === DeviceProtectionStatus.Unlocked && response.device
    ? { kind: ExtensionSessionDeviceStateKind.Active, device: response.device }
    : { kind: ExtensionSessionDeviceStateKind.Locked }
}

export async function createExtensionPasskey(
  passkeyLabel: string,
  deviceMode: DeviceMode,
): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const { setup } = await sessionMessage<
    SessionResponse<{
      setup: {
        userHandle: number[]
        prfInput: number[]
      }
    }>
  >({
    type: 'nook:extension-session-begin-passkey-setup',
  })
  const creationOptions = buildPasskeyCreationOptions(
    '',
    'Nook Extension',
    passkeyLabel,
    new Uint8Array(setup.userHandle),
    new Uint8Array(setup.prfInput),
  )
  const created = await createPasskey(creationOptions)
  const prfRequest = buildPasskeyPrfRequestOptions(
    '',
    new Uint8Array(credentialId(created)),
    new Uint8Array(setup.prfInput),
  )
  const asserted = await getPasskey(prfRequest)
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >({
      type: 'nook:extension-session-finish-passkey-setup',
      payload: {
        credentialId: credentialId(created),
        userHandle: setup.userHandle,
        prfInput: setup.prfInput,
        prfOutput: prfOutput(asserted),
        deviceMode,
      },
    })
  ).device
}

export async function recoverExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const options = buildPasskeyRecoveryRequestOptions('')
  const credential = await getPasskey(options)
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >({
      type: 'nook:extension-session-recover-passkey',
      payload: {
        credentialId: credentialId(credential),
        userHandle: assertionUserHandle(credential),
        prfOutput: prfOutput(credential),
      },
    })
  ).device
}

export async function unlockExtensionPasskey(): Promise<ExtensionDeviceProtectionResult> {
  await ensureNookWasm()
  const { material } = await sessionMessage<
    SessionResponse<{
      material: { credentialId: number[]; prfInput: number[] }
    }>
  >({
    type: 'nook:extension-session-unlock-options',
  })
  const options = buildPasskeyPrfRequestOptions(
    '',
    new Uint8Array(material.credentialId),
    new Uint8Array(material.prfInput),
  )
  const credential = await getPasskey(options)
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >({
      type: 'nook:extension-session-unlock-passkey',
      payload: { prfOutput: prfOutput(credential) },
    })
  ).device
}

export async function createExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >({
      type: 'nook:extension-session-create-pin',
      payload: { pin },
    })
  ).device
}

export async function unlockExtensionPin(
  pin: string,
): Promise<ExtensionDeviceProtectionResult> {
  return (
    await sessionMessage<
      SessionResponse<{ device: ExtensionDeviceProtectionResult }>
    >({
      type: 'nook:extension-session-unlock-pin',
      payload: { pin },
    })
  ).device
}

export async function generateSuggestedPassword(
  options: PasswordGenerationOptions = defaultPasswordGenerationOptions,
): Promise<string> {
  await ensureNookWasm()
  return generatePasswordWithOptions(wasmGeneratePassword, options)
}

export async function parseStoredAppLocale(
  input: StoredAppLocaleInput,
): Promise<StoredAppLocaleParse> {
  await ensureNookWasm()
  const parsed = wasmParseAppLocale(
    input.kind === StoredAppLocaleInputKind.Stored
      ? intoWasmStringValue(input.value)
      : NookStringValue.unavailable(),
  )
  try {
    return parsed.state === NookValueState.Value
      ? {
          kind: StoredAppLocaleParseKind.Supported,
          locale: parsed.string as NookAppLocale,
        }
      : { kind: StoredAppLocaleParseKind.Unsupported }
  } finally {
    parsed.free()
  }
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
  const catalog = readWasmCatalog(locale)
  return catalog.kind === WasmCatalogReadKind.Available
    ? wasmResolveTranslationCatalog(locale, catalog.catalog)
    : wasmDefaultTranslationCatalog(locale)
}

enum WasmCatalogReadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

type WasmCatalogRead =
  | { kind: WasmCatalogReadKind.Available; catalog: string }
  | { kind: WasmCatalogReadKind.Unavailable }

function readWasmCatalog(locale: NookAppLocale): WasmCatalogRead {
  try {
    return {
      kind: WasmCatalogReadKind.Available,
      catalog: wasmGetTranslationCatalog(locale),
    }
  } catch {
    return { kind: WasmCatalogReadKind.Unavailable }
  }
}
